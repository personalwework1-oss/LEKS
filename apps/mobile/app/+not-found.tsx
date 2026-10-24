import { Redirect } from "expo-router";
import { useSession } from "@/state/session";

/**
 * The app opens at "/" (and the router lands on whatever address was open
 * when the account state changes). Only signed-in users have a screen there,
 * so anything unknown goes to the start screen for the current state.
 */
export default function NotFound() {
  const { status } = useSession();
  switch (status) {
    case "signedOut":
      return <Redirect href="/welcome" />;
    case "onboarding":
      return <Redirect href="/start" />;
    case "locked":
      return <Redirect href="/lock" />;
    case "ready":
      return <Redirect href="/" />;
    default:
      return null;
  }
}
