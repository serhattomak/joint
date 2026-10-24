/**
 * Marka işareti — JointVault'un kutusu: kayıtlar kutuya girer, ortadaki mavi olan son girendir.
 *
 * Tam ikonun (`public/favicon.svg`) tek renk hâli: gövde temaya uyar (`currentColor`),
 * kart her iki temada da tek aksanı taşır. Platform noktaları 18px'te öldüğü için düşer.
 * viewBox işaretin kendi sınırlarına kırpılır; 18px kutuda kaybolmaz.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="192 176 640 640" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor" opacity={0.45}>
        <g transform="rotate(-10 391 400)">
          <rect x="296" y="262" width="190" height="300" rx="24" />
        </g>
        <g transform="rotate(9 655 400)">
          <rect x="560" y="264" width="190" height="300" rx="24" />
        </g>
      </g>
      <rect x="412" y="216" width="200" height="340" rx="24" fill="var(--color-primary)" />
      <rect x="252" y="458" width="520" height="22" rx="11" fill="currentColor" opacity={0.45} />
      <rect x="232" y="480" width="560" height="296" rx="44" fill="currentColor" />
    </svg>
  );
}
