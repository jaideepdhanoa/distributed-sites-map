import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Distributed Infra",
    short_name: "Distributed Infra",
    description: "Site pipeline map for Phoenix, Las Vegas and Miami",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#1e4636",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
