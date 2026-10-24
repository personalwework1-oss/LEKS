import {
  AudioSession,
  LiveKitRoom,
  isTrackReference,
  useLocalParticipant,
  useRNE2EEManager,
  useConnectionState,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { ConnectionState, type LocalVideoTrack, RoomEvent, Track } from "livekit-client";
import { useEffect, useState } from "react";
import { Modal, PermissionsAndroid, Platform, Pressable, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/Icon";
import { AppText, Avatar } from "@/components/ui";
import { formatDuration } from "@/features/waveform";
import { useConversation } from "@/messaging/hooks";
import { useSession } from "@/state/session";
import { LeksCalls } from "../../modules/leks-calls";
import type { CallState, EndReason } from "./CallManager";

const ENDED_TEXT: Record<EndReason, string> = {
  hung_up: "Звонок завершён",
  declined: "Звонок отклонён",
  no_answer: "Нет ответа",
  missed: "Пропущенный звонок",
  busy: "Занято",
  failed: "Не удалось соединиться",
  answered_elsewhere: "Ответили на другом устройстве",
};

/** Follows the call manager's state. */
function useCallState(): CallState | null {
  const { calls } = useSession();
  const [state, setState] = useState<CallState | null>(calls?.state ?? null);
  useEffect(() => {
    if (!calls) return;
    setState(calls.state);
    return calls.subscribe(setState);
  }, [calls]);
  return state;
}

/** Shown over the whole app while a call rings or runs; mounted once in the app layout. */
export function CallOverlay() {
  const { calls } = useSession();
  const state = useCallState();
  const [toast, setToast] = useState<EndReason | null>(null);

  // Briefly say how a call ended, then go back to the app.
  useEffect(() => {
    if (state?.phase !== "idle" || !state.ended) return;
    setToast(state.ended);
    calls?.dismiss();
  }, [state?.phase, state?.ended]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  // While a call rings or runs: no second ringing notification, and the call shows over the lock screen.
  useEffect(() => {
    const busy = !!state && state.phase !== "idle";
    if (busy) LeksCalls?.cancelIncomingCall();
    LeksCalls?.setShowOverLockScreen(busy);
  }, [state?.phase]);

  // Vibrate while an incoming call rings.
  useEffect(() => {
    if (state?.phase !== "incoming") return;
    Vibration.vibrate([0, 600, 900], true);
    return () => Vibration.cancel();
  }, [state?.phase]);

  if (!state || !calls) return null;
  const visible = state.phase !== "idle" || !!toast;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => undefined} statusBarTranslucent>
      {state.phase === "idle" ? <Ended reason={toast} onClose={() => setToast(null)} /> : <CallScreen state={state} />}
    </Modal>
  );
}

function Ended({ reason, onClose }: { reason: EndReason | null; onClose: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Вернуться в приложение" onPress={onClose} style={{ flex: 1, backgroundColor: "#0E1117", alignItems: "center", justifyContent: "center" }}>
      <AppText variant="heading" color="#FFFFFF">
        {reason ? ENDED_TEXT[reason] : ""}
      </AppText>
    </Pressable>
  );
}

function CallScreen({ state }: { state: CallState }) {
  const insets = useSafeAreaInsets();
  const { calls } = useSession();
  const { data: chat } = useConversation(state.conversationId ?? "");
  const name = chat?.kind === "group" ? chat.title : (chat?.title ?? "Собеседник");
  const caller = chat?.kind === "group" ? chat.members.find((m) => m.accountId === state.from)?.displayName : null;
  const connected = !!state.url && !!state.token && !!state.key && state.phase !== "incoming";

  return (
    <View style={{ flex: 1, backgroundColor: "#0E1117", paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      {connected ? (
        <Connected state={state} name={name} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 14 }}>
          <Avatar name={name} seed={state.conversationId ?? ""} size={112} />
          <AppText variant="title" color="#FFFFFF" style={{ textAlign: "center", paddingHorizontal: 24 }}>
            {name}
          </AppText>
          <AppText color="rgba(255,255,255,0.7)" accessibilityLiveRegion="polite">
            {state.phase === "incoming"
              ? `${caller ? `${caller}: ` : ""}${state.video ? "видеозвонок" : "аудиозвонок"}`
              : state.phase === "outgoing"
                ? "Вызов…"
                : "Соединение…"}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="lock" size={13} color="rgba(255,255,255,0.6)" strokeWidth={2.4} />
            <AppText variant="caption" color="rgba(255,255,255,0.6)">
              Сквозное шифрование
            </AppText>
          </View>
        </View>
      )}

      {state.phase === "incoming" ? (
        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 40 }}>
          <RoundButton icon="callEnd" label="Отклонить" color="#E5484D" onPress={() => void calls?.decline()} />
          <RoundButton icon={state.video ? "video" : "phone"} label="Ответить" color="#30A46C" onPress={() => void calls?.accept()} />
        </View>
      ) : connected ? null : (
        <View style={{ alignItems: "center" }}>
          <RoundButton icon="callEnd" label="Завершить" color="#E5484D" onPress={() => void calls?.hangUp()} />
        </View>
      )}
    </View>
  );
}

/** Asks for the microphone (and camera for video) before joining; Android needs this up front. */
async function askForMedia(video: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

/** In the room: video tiles (or the name), the timer and controls. */
function Connected({ state, name }: { state: CallState; name: string }) {
  const { e2eeManager } = useRNE2EEManager({ sharedKey: state.key ?? "" });
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const allowed = await askForMedia(state.video);
      if (!alive) return;
      if (!allowed) {
        setProblem("Нет доступа к микрофону. Разрешите его в настройках телефона.");
        return;
      }
      await AudioSession.startAudioSession();
      if (alive) setReady(true);
    })().catch((error: unknown) => alive && setProblem(`Не удалось включить звук: ${String(error)}`));
    return () => {
      alive = false;
      void AudioSession.stopAudioSession();
    };
  }, []);

  if (!ready) return <Waiting name={name} state={state} text={problem ?? "Подключение…"} warn={!!problem} />;

  return (
    <LiveKitRoom
      serverUrl={state.url ?? ""}
      token={state.token ?? ""}
      connect
      audio
      video={state.video}
      options={{ adaptiveStream: { pixelDensity: "screen" }, e2ee: { e2eeManager } }}
      onError={(error) => setProblem(error.message)}
      onDisconnected={() => setProblem((current) => current ?? "Соединение прервалось")}
    >
      <RoomView state={state} name={name} problem={problem} />
    </LiveKitRoom>
  );
}

function Waiting({ name, state, text, warn }: { name: string; state: CallState; text: string; warn?: boolean }) {
  const { calls } = useSession();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 14 }}>
        <Avatar name={name} seed={state.conversationId ?? ""} size={112} />
        <AppText variant="title" color="#FFFFFF" style={{ textAlign: "center", paddingHorizontal: 24 }}>
          {name}
        </AppText>
        <AppText color={warn ? "#F5A623" : "rgba(255,255,255,0.7)"} style={{ textAlign: "center", paddingHorizontal: 24 }} accessibilityLiveRegion="polite">
          {text}
        </AppText>
      </View>
      <View style={{ alignItems: "center" }}>
        <RoundButton icon="callEnd" label="Завершить" color="#E5484D" onPress={() => void calls?.hangUp()} />
      </View>
    </View>
  );
}

const CONNECTION_TEXT: Partial<Record<ConnectionState, string>> = {
  [ConnectionState.Connecting]: "Подключение…",
  [ConnectionState.Reconnecting]: "Переподключение…",
  [ConnectionState.SignalReconnecting]: "Переподключение…",
  [ConnectionState.Disconnected]: "Нет соединения",
};

function RoomView({ state, name, problem }: { state: CallState; name: string; problem: string | null }) {
  const { calls } = useSession();
  const room = useRoomContext();
  const connection = useConnectionState(room);
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const [encrypted, setEncrypted] = useState(false);
  const [front, setFront] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [others, setOthers] = useState(room.remoteParticipants.size);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  // Video calls start on the speaker; so do phones without an earpiece.
  const [speaker, setSpeaker] = useState(state.video);

  useEffect(() => {
    void (async () => {
      const outputs = await AudioSession.getAudioOutputs();
      const useSpeaker = state.video || (Platform.OS === "android" && !outputs.includes("earpiece"));
      await route(useSpeaker);
      setSpeaker(useSpeaker);
    })().catch((e: unknown) => console.warn("audio route", e));
  }, []);

  async function route(on: boolean) {
    if (Platform.OS === "ios") await AudioSession.selectAudioOutput(on ? "force_speaker" : "default");
    else await AudioSession.selectAudioOutput(on ? "speaker" : "earpiece");
  }

  // Media is encrypted on the phone. LiveKit reports when that is actually on.
  useEffect(() => {
    const onStatus = (enabled: boolean, participant?: { isLocal?: boolean }) => {
      if (!participant || participant.isLocal) setEncrypted(enabled);
    };
    room.on(RoomEvent.ParticipantEncryptionStatusChanged, onStatus);
    void room.setE2EEEnabled(true).catch(() => setEncrypted(false));
    return () => {
      room.off(RoomEvent.ParticipantEncryptionStatusChanged, onStatus);
    };
  }, [room]);

  // The timer starts when the other person is actually in the call.
  useEffect(() => {
    const update = () => {
      const count = room.remoteParticipants.size;
      setOthers(count);
      if (count > 0) setJoinedAt((at) => at ?? Date.now());
    };
    update();
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    return () => {
      room.off(RoomEvent.ParticipantConnected, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
    };
  }, [room]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remote = tracks.filter((t) => isTrackReference(t) && !t.participant.isLocal);
  const mine = tracks.find((t) => isTrackReference(t) && t.participant.isLocal);
  const live = connection === ConnectionState.Connected;

  async function flipCamera() {
    const camera = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!camera) return;
    await camera.restartTrack({ facingMode: front ? "environment" : "user" });
    setFront(!front);
  }

  const status = problem
    ? problem
    : !live
      ? (CONNECTION_TEXT[connection] ?? "Подключение…")
      : others === 0
        ? state.phase === "outgoing"
          ? "Вызов…"
          : "Ожидание собеседника…"
        : formatDuration(now - (joinedAt ?? now));

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, gap: 6, paddingHorizontal: 6 }}>
        {state.video && remote.length > 0 ? (
          remote.map((t) =>
            isTrackReference(t) ? <VideoTrack key={t.participant.identity} trackRef={t} style={{ flex: 1, borderRadius: 18, overflow: "hidden" }} objectFit="cover" /> : null,
          )
        ) : (
          <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 14 }}>
            <Avatar name={name} seed={state.conversationId ?? ""} size={112} />
            <AppText variant="title" color="#FFFFFF" style={{ textAlign: "center", paddingHorizontal: 24 }}>
              {name}
            </AppText>
          </View>
        )}
        {state.video && mine && isTrackReference(mine) && isCameraEnabled ? (
          <VideoTrack trackRef={mine} mirror={front} style={{ position: "absolute", right: 18, bottom: 18, width: 110, height: 160, borderRadius: 14, overflow: "hidden" }} objectFit="cover" />
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 24 }}>
        <AppText color={problem ? "#F5A623" : "#FFFFFF"} style={{ fontVariant: ["tabular-nums"], textAlign: "center" }} accessibilityLiveRegion="polite">
          {status}
        </AppText>
        {live ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name={encrypted ? "lock" : "warning"} size={13} color={encrypted ? "rgba(255,255,255,0.6)" : "#F5A623"} strokeWidth={2.4} />
            <AppText variant="caption" color={encrypted ? "rgba(255,255,255,0.6)" : "#F5A623"}>
              {encrypted ? "Сквозное шифрование" : "Включается шифрование…"}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-evenly", alignItems: "center" }}>
        <RoundButton
          icon={isMicrophoneEnabled ? "mic" : "micOff"}
          label={isMicrophoneEnabled ? "Микрофон" : "Без звука"}
          color={isMicrophoneEnabled ? "rgba(255,255,255,0.16)" : "#FFFFFF"}
          iconColor={isMicrophoneEnabled ? "#FFFFFF" : "#0E1117"}
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch((e: unknown) => console.warn("mic", e))}
        />
        <RoundButton
          icon={isCameraEnabled ? "video" : "videoOff"}
          label={isCameraEnabled ? "Видео" : "Видео выкл."}
          color={isCameraEnabled ? "rgba(255,255,255,0.16)" : "#FFFFFF"}
          iconColor={isCameraEnabled ? "#FFFFFF" : "#0E1117"}
          onPress={() =>
            void (async () => {
              if (!isCameraEnabled && !(await askForMedia(true))) return;
              await localParticipant.setCameraEnabled(!isCameraEnabled);
            })().catch((e: unknown) => console.warn("camera", e))
          }
        />
        <RoundButton
          icon="speaker"
          label={speaker ? "Динамик вкл." : "Динамик"}
          color={speaker ? "#FFFFFF" : "rgba(255,255,255,0.16)"}
          iconColor={speaker ? "#0E1117" : "#FFFFFF"}
          onPress={() =>
            void route(!speaker)
              .then(() => setSpeaker(!speaker))
              .catch((e: unknown) => console.warn("speaker", e))
          }
        />
        {isCameraEnabled ? <RoundButton icon="flip" label="Камера" color="rgba(255,255,255,0.16)" onPress={() => void flipCamera()} /> : null}
        <RoundButton icon="callEnd" label="Конец" color="#E5484D" onPress={() => void calls?.hangUp()} />
      </View>
    </View>
  );
}

function RoundButton({ icon, label, color, iconColor = "#FFFFFF", onPress }: { icon: IconName; label: string; color: string; iconColor?: string; onPress: () => void }) {
  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 30, backgroundColor: color, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1 })}
      >
        <Icon name={icon} size={28} color={iconColor} strokeWidth={2} />
      </Pressable>
      <AppText variant="caption" color="rgba(255,255,255,0.8)">
        {label}
      </AppText>
    </View>
  );
}
