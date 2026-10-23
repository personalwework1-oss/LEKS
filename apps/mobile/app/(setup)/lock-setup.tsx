import { router } from "expo-router";
import { AppText, Screen, StepHeader } from "@/components/ui";
import { LockChooser } from "@/features/LockChooser";
import { useSession } from "@/state/session";

export default function LockSetupStep() {
  const { onboarding, finishOnboarding } = useSession();
  const fromRegistration = onboarding === "register";
  return (
    <Screen scroll>
      {fromRegistration ? (
        <StepHeader step={3} of={3} onBack={router.canGoBack() ? () => router.back() : undefined} />
      ) : null}
      <AppText variant="title" style={{ marginTop: fromRegistration ? 30 : 40 }}>
        Защитите вход в приложение
      </AppText>
      <AppText muted style={{ marginTop: 10 }}>
        Даже если кто-то возьмёт ваш телефон, он не откроет переписку.
      </AppText>
      <LockChooser onDone={finishOnboarding} onSkip={finishOnboarding} skipTitle="Позже" />
    </Screen>
  );
}
