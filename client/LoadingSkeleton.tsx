export default function LoadingSkeleton() {
  return (
    <section
      className="loading-skeleton"
      role="status"
      aria-label="Opening your local space"
    >
      <span className="sr-only">Loading the local app</span>
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton-frame">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-field" />
        <div className="skeleton skeleton-field" />
        <div className="skeleton skeleton-button" />
      </div>
    </section>
  );
}
