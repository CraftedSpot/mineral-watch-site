interface SkeletonRowsProps {
  count?: number;
}

export function SkeletonRows({ count = 3 }: SkeletonRowsProps) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 14, borderRadius: 4, marginBottom: 10,
            background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease-in-out infinite',
            width: `${70 + (i % 3) * 10}%`,
          }}
        />
      ))}
    </div>
  );
}
