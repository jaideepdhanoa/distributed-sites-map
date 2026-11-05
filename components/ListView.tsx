"use client";

export type ListRow = {
  id: string;
  site: string;
  type: string;
  city: string;
  stage: string;
  tier: string;
  spare: string;
  zoning: string;
  traffic: string;
  listed: string;
  lead: string;
};

export const LIST_COLUMNS: { id: keyof Omit<ListRow, "id">; label: string }[] = [
  { id: "site", label: "Site" },
  { id: "type", label: "Type" },
  { id: "city", label: "City" },
  { id: "stage", label: "Stage" },
  { id: "tier", label: "Size tier" },
  { id: "spare", label: "Spare land" },
  { id: "zoning", label: "Zoning" },
  { id: "traffic", label: "Traffic count" },
  { id: "listed", label: "Listed" },
  { id: "lead", label: "Lead source" },
];

export function listCsv(rows: ListRow[]) {
  const header = LIST_COLUMNS.map((column) => column.label);
  const lines = [
    header.join(","),
    ...rows.map((row) => LIST_COLUMNS.map((column) => `"${String(row[column.id] ?? "").replace(/"/g, "\"\"")}"`).join(",")),
  ];
  return lines.join("\n");
}

export default function ListView({
  rows,
  selectedId,
  sort,
  onSort,
  onOpen,
  onShowMap,
  onExport,
}: {
  rows: ListRow[];
  selectedId: string | null;
  sort: { id: keyof Omit<ListRow, "id">; desc: boolean };
  onSort: (id: keyof Omit<ListRow, "id">, desc?: boolean) => void;
  onOpen: (id: string) => void;
  onShowMap: (id: string) => void;
  onExport: () => void;
}) {
  return (
    <div className="list-pane" data-list-count={rows.length}>
      <div className="list-bar">
        <p>{rows.length.toLocaleString()} shown</p>
        <label className="list-sort only-mobile">
          Sort
          <select
            aria-label="Sort"
            value={`${sort.id}:${sort.desc ? "desc" : "asc"}`}
            onChange={(event) => {
              const [id, direction] = event.target.value.split(":");
              onSort(id as keyof Omit<ListRow, "id">, direction === "desc");
            }}
          >
            {LIST_COLUMNS.flatMap((column) => [
              <option key={`${column.id}:asc`} value={`${column.id}:asc`}>{column.label}, A to Z</option>,
              <option key={`${column.id}:desc`} value={`${column.id}:desc`}>{column.label}, Z to A</option>,
            ])}
          </select>
        </label>
        <button type="button" onClick={onExport}>Export CSV</button>
      </div>
      <div className="list-scroll">
        <table className="list-table">
          <thead>
            <tr>
              {LIST_COLUMNS.map((column) => {
                const active = sort.id === column.id;
                const direction = active && sort.desc ? "descending" : active ? "ascending" : "none";
                return (
                  <th key={column.id} aria-sort={direction}>
                    <button type="button" onClick={() => onSort(column.id)}>
                      {column.label}
                      {active ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                );
              })}
              <th aria-sort="none"><span className="sr">Map</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === selectedId ? "on" : ""} onClick={() => onOpen(row.id)}>
                {LIST_COLUMNS.map((column) => <td key={column.id} title={row[column.id] || ""}>{row[column.id] || "—"}</td>)}
                <td>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onShowMap(row.id); }}>Show on map</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-cards">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className={row.id === selectedId ? "on" : ""} onClick={() => onOpen(row.id)}>
                <strong>{row.site}</strong>
                <span>{[row.city, row.stage, row.tier].filter(Boolean).join(" · ")}</span>
              </button>
              <button type="button" onClick={() => onShowMap(row.id)}>Show on map</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
