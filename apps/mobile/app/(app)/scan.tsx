import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, IconButton } from "@/components/ui";
import { usernameFromLink } from "@/features/profileLink";

/** Scans someone's profile QR code and opens their profile. */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [wrong, setWrong] = useState(false);
  const done = useRef(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", padding: 24, paddingTop: insets.top + 12, gap: 16 }}>
        <IconButton icon="back" label="Назад" tone="plain" onPress={() => router.back()} />
        <AppText color="#FFFFFF" variant="heading">
          Нужен доступ к камере
        </AppText>
        <AppText color="rgba(255,255,255,0.75)">Чтобы прочитать QR-код. Ничего не снимается и не сохраняется.</AppText>
        <Button title="Разрешить" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          const username = usernameFromLink(data);
          if (!username) {
            setWrong(true);
            return;
          }
          done.current = true;
          router.replace({ pathname: "/u/[username]", params: { username } });
        }}
      />
      <View style={{ position: "absolute", top: insets.top + 8, left: 8 }}>
        <IconButton icon="close" label="Закрыть" tone="soft" onPress={() => router.back()} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" }} />
      </View>
      <View style={{ position: "absolute", left: 24, right: 24, bottom: insets.bottom + 32 }}>
        <AppText color="#FFFFFF" style={{ textAlign: "center" }}>
          {wrong ? "Это не код профиля LEKS." : "Наведите камеру на QR-код профиля"}
        </AppText>
      </View>
    </View>
  );
}
