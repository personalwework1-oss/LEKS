# CI report for 2a7640205b8982cf966d53c47845e5270cf4119d

- iOS app (simulator build): success
- Android app (APK): success
- Android app starts (emulator): success
- Report (app builds): in_progress

## iOS app (simulator build) (success)

```
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
[36;1mls -d build/Build/Products/Release-iphonesimulator/*.app && echo "app-release ios simulator build ok"[0m
  CACHE_ON_FAILURE: false
RegisterExecutionPolicyException /Users/runner/work/LEKS/LEKS/apps/mobile/ios/build/Build/Products/Release-iphonesimulator/LEKS.app (in target 'LEKS' from project 'LEKS')
    builtin-RegisterExecutionPolicyException /Users/runner/work/LEKS/LEKS/apps/mobile/ios/build/Build/Products/Release-iphonesimulator/LEKS.app
app-release ios simulator build ok
```

## Android app (APK) (success)

```
  CACHE_ON_FAILURE: false
-rwxr-xr-x 1 runner runner 2.3M Oct 26 22:37 /home/runner/work/LEKS/LEKS/apps/mobile/modules/leks-crypto/android/src/main/jniLibs/arm64-v8a/libleks_crypto.so
-rwxr-xr-x 1 runner runner 2.8M Oct 26 22:38 /home/runner/work/LEKS/LEKS/apps/mobile/modules/leks-crypto/android/src/main/jniLibs/x86_64/libleks_crypto.so
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
##[group]Run if [ -n "$GOOGLE_SERVICES_JSON" ]; then printf '%s' "$GOOGLE_SERVICES_JSON" > google-services.json; echo "push: on"; else echo "push: off (no GOOGLE_SERVICES_JSON secret)"; fi
[36;1mif [ -n "$GOOGLE_SERVICES_JSON" ]; then printf '%s' "$GOOGLE_SERVICES_JSON" > google-services.json; echo "push: on"; else echo "push: off (no GOOGLE_SERVICES_JSON secret)"; fi[0m
  CACHE_ON_FAILURE: false
push: on
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
[36;1munzip -l *.apk | grep libleks_crypto.so[0m
  CACHE_ON_FAILURE: false
-rw-r--r-- 1 runner runner 108M Oct 26 22:45 app-release.apk
  2389688  1981-01-01 01:01   lib/arm64-v8a/libleks_crypto.so
  2929952  1981-01-01 01:01   lib/x86_64/libleks_crypto.so
  CACHE_ON_FAILURE: false
```

## Android app starts (emulator) (success)

```
grep -o 'text="[^"]*"' ui.xml | grep -v 'text=""' | head -40 || true
echo "--- app errors ---"; grep -E "FATAL|Error|Exception" logcat.txt | head -40 || true
if grep -q "Unmatched" ui.xml; then echo "smoke: unmatched route"; exit 1; fi
if [ ! -f found.txt ]; then echo "smoke: welcome screen not shown"; exit 1; fi
echo "smoke: welcome screen ok"
grep -o 'text="[^"]*"' ui.xml | grep -v 'text=""' | head -40 || true
echo "--- app errors ---"; grep -E "FATAL|Error|Exception" logcat.txt | head -40 || true
if grep -q "Unmatched" ui.xml; then echo "smoke: unmatched route"; exit 1; fi
if [ ! -f found.txt ]; then echo "smoke: welcome screen not shown"; exit 1; fi
echo "smoke: welcome screen ok"
[command]/usr/bin/sh -c grep -o 'text="[^"]*"' ui.xml | grep -v 'text=""' | head -40 || true
text="Переписка, которая принадлежит только вам"
text="Мессенджер для личного общения и работы. Без номера телефона и лишних данных."
text="Только имя пользователя"
text="Номер телефона и почта не нужны"
text="Шифрование во всех чатах"
text="Включено всегда, в группах тоже"
text="Сервер ничего не читает"
text="Ключи хранятся только на ваших устройствах"
[command]/usr/bin/sh -c echo "--- app errors ---"; grep -E "FATAL|Error|Exception" logcat.txt | head -40 || true
[command]/usr/bin/sh -c if grep -q "Unmatched" ui.xml; then echo "smoke: unmatched route"; exit 1; fi
[command]/usr/bin/sh -c if [ ! -f found.txt ]; then echo "smoke: welcome screen not shown"; exit 1; fi
[command]/usr/bin/sh -c echo "smoke: welcome screen ok"
smoke: welcome screen ok
```

## Report (app builds) (null)

```
```
