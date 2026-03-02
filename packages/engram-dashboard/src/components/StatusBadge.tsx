interface Props {
  status: string;
  size?: "sm" | "md";
}

export default function StatusBadge({ status, size = "md" }: Props) {
  const cls = `badge badge-${status.toLowerCase().replace(/_/g, "-").replace(/ /g, "-")}`;
  return (
    <span className={cls} style={size === "sm" ? { fontSize: 10, padding: "1px 6px" } : {}}>
      {status}
    </span>
  );
}
