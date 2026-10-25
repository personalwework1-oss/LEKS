import { Image, Modal, Pressable, useWindowDimensions } from "react-native";
import { AppText } from "./ui";

/** A profile photo on the whole screen; tap anywhere to close. */
export function PhotoViewer({ photo, name, onClose }: { photo: string | null; name: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const side = Math.min(width, height);
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть фото"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center", gap: 18 }}
      >
        {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={{ width: side, height: side }} resizeMode="contain" /> : null}
        <AppText color="#FFFFFF">{name}</AppText>
      </Pressable>
    </Modal>
  );
}
