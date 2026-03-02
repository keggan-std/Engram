interface Props {
  title?: string;
  message?: string;
  icon?: string;
}

export default function EmptyState({ title = "Nothing here yet", message, icon = "◎" }: Props) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "64px 32px",
      gap: 12,
      color: "var(--text-faint)",
    }}>
      <span style={{ fontSize: 32 }}>{icon}</span>
      <p style={{ fontSize: 15, color: "var(--text-muted)", fontWeight: 500 }}>{title}</p>
      {message && <p style={{ fontSize: 13, textAlign: "center", maxWidth: 320 }}>{message}</p>}
    </div>
  );
}
