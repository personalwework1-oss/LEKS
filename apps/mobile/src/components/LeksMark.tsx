import Svg, { Defs, G, Mask, Path, Rect } from "react-native-svg";

/** The LEKS sign (without the wordmark), redrawn from the brand logo. */
export function LeksMark({ size = 64, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="238 122 548 548" accessibilityLabel="LEKS" accessibilityRole="image">
      <Defs>
        <Mask id="leks-mark-cut" maskUnits="userSpaceOnUse" x="238" y="122" width="548" height="548">
          <Rect x="305.9" y="190" width="412.8" height="412.8" rx="59" transform="rotate(45 512.3 396.4)" fill="#fff" />
          <G fill="none" stroke="#000" strokeWidth={62} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M509.4 228.6L344.6 392L453.7 499.4" />
            <Path d="M576.7 301.6L677.8 401.9L516.7 562.2" />
          </G>
          <Rect x="443.5" y="357.5" width="135.7" height="47.5" rx="19.9" fill="#000" />
          <Rect x="479.9" y="424.4" width="61.3" height="33.4" rx="15.9" fill="#000" />
        </Mask>
      </Defs>
      <Rect x="238" y="122" width="548" height="548" fill={color} mask="url(#leks-mark-cut)" />
    </Svg>
  );
}
