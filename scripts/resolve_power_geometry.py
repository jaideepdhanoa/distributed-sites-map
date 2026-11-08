#!/usr/bin/env python3
"""Resolve nearest OSM substation and high-voltage line geometry.

The workbook stores only distances (substation miles, line feet). This asks
Overpass for power=substation and power=line around each located deal, then
keeps a feature only when its distance matches that stored figure. A miss is
left out. Stored distances are not rewritten.
"""

from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEALS = ROOT / "data" / "generated" / "deals.geojson"
OUT = ROOT / "data" / "generated" / "power.geojson"
ENDPOINT = "https://overpass.openstreetmap.fr/api/interpreter"
SUB_TOL_MI = 0.02
LINE_TOL_FT = 80


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    arc = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(min(1.0, arc)))


def points_of(element: dict) -> list[tuple[float, float]]:
    if element["type"] == "node":
        return [(element["lon"], element["lat"])]
    return [(point["lon"], point["lat"]) for point in element.get("geometry") or []]


def distance_m(lon: float, lat: float, pts: list[tuple[float, float]]) -> float | None:
    if not pts:
        return None
    best = min(haversine_m(lon, lat, x, y) for x, y in pts)
    lat0 = math.radians(lat)
    def xy(x: float, y: float) -> tuple[float, float]:
        return ((x - lon) * math.cos(lat0) * 111_320, (y - lat) * 110_540)
    for index in range(len(pts) - 1):
        ax, ay = xy(*pts[index])
        bx, by = xy(*pts[index + 1])
        dx, dy = bx - ax, by - ay
        denom = dx * dx + dy * dy
        if not denom:
            continue
        tee = max(0.0, min(1.0, ((-ax) * dx + (-ay) * dy) / denom))
        best = min(best, math.hypot(ax + tee * dx, ay + tee * dy))
    return best


def overpass(lon: float, lat: float) -> list[dict]:
    radius = 4000
    query = f"""
[out:json][timeout:70];
(
  nwr["power"="substation"](around:{radius},{lat},{lon});
  way["power"="line"](around:{radius},{lat},{lon});
);
out geom;
"""
    request = urllib.request.Request(
        ENDPOINT,
        data=query.encode(),
        headers={"User-Agent": "distributed-sites-map/power-geometry"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode())
    return payload.get("elements") or []


def clip(pts: list[tuple[float, float]], lon: float, lat: float, limit_m: float = 3500) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return pts
    kept: list[tuple[float, float]] = []
    for index, point in enumerate(pts):
        near = haversine_m(lon, lat, point[0], point[1]) <= limit_m
        neighbor = False
        if index:
            neighbor = neighbor or haversine_m(lon, lat, pts[index - 1][0], pts[index - 1][1]) <= limit_m
        if index + 1 < len(pts):
            neighbor = neighbor or haversine_m(lon, lat, pts[index + 1][0], pts[index + 1][1]) <= limit_m
        if near or neighbor:
            if kept and kept[-1] != point:
                kept.append(point)
            elif not kept:
                kept.append(point)
    return kept or pts[:2]


def geometry_for(element: dict, lon: float, lat: float, kind: str) -> dict | None:
    pts = points_of(element)
    if not pts:
        return None
    if element["type"] == "node" or len(pts) == 1:
        return {"type": "Point", "coordinates": [pts[0][0], pts[0][1]]}
    if kind == "substation" and pts[0] == pts[-1] and len(pts) >= 4:
        return {"type": "Polygon", "coordinates": [[[x, y] for x, y in pts]]}
    line = clip(pts, lon, lat)
    if len(line) < 2:
        line = pts
    return {"type": "LineString", "coordinates": [[x, y] for x, y in line]}


def label_point(element: dict, lon: float, lat: float) -> list[float]:
    pts = points_of(element)
    if not pts:
        return [lon, lat]
    best = min(pts, key=lambda point: haversine_m(lon, lat, point[0], point[1]))
    if element["type"] != "node" and (element.get("tags") or {}).get("power") == "substation":
        return [sum(point[0] for point in pts) / len(pts), sum(point[1] for point in pts) / len(pts)]
    return [best[0], best[1]]


def nearest(elements: list[dict], lon: float, lat: float, power: str) -> tuple[dict, float] | None:
    best: tuple[dict, float] | None = None
    for element in elements:
        if (element.get("tags") or {}).get("power") != power:
            continue
        meters = distance_m(lon, lat, points_of(element))
        if meters is None:
            continue
        if best is None or meters < best[1]:
            best = (element, meters)
    return best


def feature(deal_id: str, site_id: str, kind: str, label: str, element: dict, lon: float, lat: float) -> list[dict]:
    shape = geometry_for(element, lon, lat, kind)
    if not shape:
        return []
    props = {"deal_id": deal_id, "site_id": site_id, "kind": kind, "label": label}
    features = [{"type": "Feature", "geometry": shape, "properties": props}]
    if shape["type"] != "Point":
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": label_point(element, lon, lat)},
            "properties": {**props, "label_only": True},
        })
    return features


def main() -> None:
    deals = json.loads(DEALS.read_text())["features"]
    features: list[dict] = []
    notes: list[str] = []
    for item in deals:
        props = item["properties"]
        geometry = item.get("geometry") or {}
        coords = geometry.get("coordinates")
        sub = props.get("cap_a_substation_mi")
        line = props.get("cap_a_line_ft")
        if not coords or (sub is None and line is None):
            continue
        lon, lat = coords
        deal_id = props["deal_id"]
        site_id = props.get("universe_id") or ""
        try:
            elements = overpass(lon, lat)
        except Exception as error:  # noqa: BLE001
            notes.append(f"{deal_id}: Overpass failed ({error})")
            time.sleep(2)
            continue
        sub_hit = nearest(elements, lon, lat, "substation") if sub is not None else None
        line_hit = nearest(elements, lon, lat, "line") if line is not None else None
        if sub_hit:
            miles = sub_hit[1] / 1609.344
            if abs(miles - float(sub)) <= SUB_TOL_MI:
                name = (sub_hit[0].get("tags") or {}).get("name") or "Substation"
                text = f"{name} · {float(sub):.2f} mi"
                features.extend(feature(deal_id, site_id, "substation", text, sub_hit[0], lon, lat))
            else:
                notes.append(f"{deal_id}: substation {miles:.2f} mi does not match stored {sub} mi")
        elif sub is not None:
            notes.append(f"{deal_id}: no OSM substation within range")
        if line_hit:
            feet = line_hit[1] / 0.3048
            allowance = max(LINE_TOL_FT, 0.08 * float(line))
            if abs(feet - float(line)) <= allowance:
                text = f"High-voltage line · {int(round(float(line))):,} ft"
                features.extend(feature(deal_id, site_id, "line", text, line_hit[0], lon, lat))
            else:
                notes.append(f"{deal_id}: nearest line {feet:.0f} ft does not match stored {int(line)} ft")
        elif line is not None:
            notes.append(f"{deal_id}: no OSM line within range")
        time.sleep(1.2)
    collection = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(collection))
    print(f"wrote {len(features)} features")
    for note in notes:
        print(note)


if __name__ == "__main__":
    main()
