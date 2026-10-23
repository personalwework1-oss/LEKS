import { Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "../theme";
import { Icon } from "./Icon";
import { AppText } from "./ui";

export interface Row {
  title: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
}

export function SettingsGroup({ title, rows, footer }: { title?: string; rows: Row[]; footer?: ReactNode }) {
  const p = usePalette();
  return (
    <View>
      {title ? (
        <AppText variant="overline" muted style={{ marginTop: 18, marginBottom: 6, marginHorizontal: 4, textTransform: "uppercase" }}>
          {title}
        </AppText>
      ) : null}
      <View style={{ borderRadius: 16, backgroundColor: p.surface, overflow: "hidden" }}>
        {rows.map((row, i) => (
          <Fragment key={row.title}>
            {i > 0 ? <View style={{ height: 1, marginLeft: 14, backgroundColor: p.separator }} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={row.value ? `${row.title}: ${row.value}` : row.title}
              onPress={row.onPress}
              style={({ pressed }) => ({
                minHeight: 50,
                paddingHorizontal: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: pressed ? p.surfaceMuted : "transparent",
              })}
            >
              <AppText style={{ flex: 1 }} color={row.destructive ? p.danger : undefined}>
                {row.title}
              </AppText>
              {row.value ? <AppText muted>{row.value}</AppText> : null}
              {row.destructive ? null : <Icon name="chevron" size={18} color={p.textSubtle} strokeWidth={2} />}
            </Pressable>
          </Fragment>
        ))}
      </View>
      {footer}
    </View>
  );
}
