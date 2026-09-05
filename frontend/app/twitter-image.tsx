import { ImageResponse } from "next/og";

export const alt =
  "ALLSHA — Buy and sell used goods safely in Rwanda. Every payment is held in escrow until delivery is confirmed.";
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
          background: "linear-gradient(135deg, #065f46 0%, #0d9488 100%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: "-0.02em" }}>
          ALLSHA
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 40,
            lineHeight: 1.3,
            color: "#d1fae5",
            fontWeight: 500,
          }}
        >
          Buy and sell used goods safely in Rwanda.
        </div>
        <div style={{ marginTop: 40, fontSize: 26, color: "#a7f3d0" }}>
          Every payment held in escrow until delivery is confirmed.
        </div>
      </div>
    ),
    { ...size },
  );
}