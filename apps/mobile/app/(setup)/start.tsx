import { Redirect } from "expo-router";
import { useSession } from "@/state/session";

/** After registration: backup code, then the app lock. After signing in on a new phone: the backup, if any, then the app lock. */
export default function SetupStart() {
  const { onboarding } = useSession();
  return <Redirect href={onboarding === "register" ? "/backup-code" : "/restore"} />;
}
