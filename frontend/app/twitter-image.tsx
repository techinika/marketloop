import { ImageResponse } from "next/og";

export const alt =
  "Handi — Made by hand, made for you. Handmade Rwandan craft, commissioned directly from artisans.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #C1622D 0%, #A5511F 100%)",
          color: "#FBF8F3",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            fontFamily: "Georgia, 'Times New Roman', serif",
          }}
        >
          Handi
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 40,
            lineHeight: 1.3,
            color: "#FAE9DC",
            fontWeight: 500,
          }}
        >
          Made by hand, made for you.
        </div>
        <div style={{ marginTop: 40, fontSize: 26, color: "#F3EDE4" }}>
          Handmade Rwandan craft — commissioned straight from the artisan.
        </div>
      </div>
    ),
    { ...size },
  );
}