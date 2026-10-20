import { fillRatio, type Status } from "@/lib/stages";

const TOP = 35; // y of the dome's top edge
const BOTTOM = 280; // y of the floor
const HEIGHT = BOTTOM - TOP;

/** The silo fills as setup moves through its stages. Pass `ratio` to show a fixed level instead. */
export function Silo(props: { status?: Status; step?: number; ratio?: number; label?: string }) {
  const { status = "provisioning", step = 0 } = props;
  const ratio = props.ratio ?? fillRatio(status, step);
  const decorative = !props.label;
  return (
    <svg
      className="silo"
      data-state={status}
      viewBox="0 0 140 300"
      role={decorative ? undefined : "img"}
      aria-label={props.label}
      aria-hidden={decorative || undefined}
    >
      <defs>
        <clipPath id="silo-clip">
          <path d={`M25 ${BOTTOM} V80 A45 45 0 0 1 115 80 V${BOTTOM} Z`} />
        </clipPath>
      </defs>
      <rect className="silo-base" x="16" y={BOTTOM} width="108" height="9" rx="2" />
      <rect className="silo-base" x="66" y="20" width="8" height="16" rx="2" />
      <path className="silo-body" d={`M25 ${BOTTOM} V80 A45 45 0 0 1 115 80 V${BOTTOM} Z`} />
      <g clipPath="url(#silo-clip)">
        <rect className="silo-fill" x="25" y={TOP} width="90" height={HEIGHT} style={{ transform: `translateY(${(1 - ratio) * HEIGHT}px)` }} />
        {[105, 135, 165, 195, 225, 255].map((y) => (
          <line key={y} className="silo-ring" x1="25" x2="115" y1={y} y2={y} />
        ))}
      </g>
      <path className="silo-outline" d={`M25 ${BOTTOM} V80 A45 45 0 0 1 115 80 V${BOTTOM} Z`} />
    </svg>
  );
}
