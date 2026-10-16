#!/usr/bin/env bash
# Construit l'APK TamaPoke sans Android Studio ni SDK :
#   apktool (aapt2 + smali embarqués) assemble manifeste, ressources, code smali
#   et assets ; uber-apk-signer aligne et signe (v1+v2+v3).
#
# Prérequis : Java 11+, python3 (+ Pillow pour l'icône), et dans tools/ :
#   apktool.jar          https://github.com/iBotPeaches/Apktool/releases
#   uber-apk-signer.jar  https://github.com/patrickfav/uber-apk-signer/releases
#
# usage : ./build.sh /chemin/vers/TamaPoke /chemin/vers/Arduino_GFX
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-$HERE/../TamaPoke}"
GFX="${2:-$HERE/../Arduino_GFX}"
TOOLS="$HERE/tools"
OUT="$HERE/dist"
WORK="$HERE/build"

python3 "$TOOLS/gen_data.py" "$REPO" "$GFX" "$HERE/www/data.js"
python3 "$TOOLS/make_icon.py"
mkdir -p "$HERE/www/mons"
cp "$REPO"/tools/sdcard/mons/*.bin "$HERE/www/mons/"

rm -rf "$WORK" && mkdir -p "$WORK/assets" "$OUT"
cp -r "$HERE/android/." "$WORK/"
cp -r "$HERE/www" "$WORK/assets/www"
VERSION_NAME="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$HERE/android/AndroidManifest.xml")"
VERSION_CODE="$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' "$HERE/android/AndroidManifest.xml")"
cat > "$WORK/apktool.yml" <<EOF
!!brut.androlib.meta.MetaInfo
apkFileName: tamapoke.apk
compressionType: false
doNotCompress:
- resources.arsc
- png
isFrameworkApk: false
packageInfo:
  forcedPackageId: '127'
  renameManifestPackage: null
sdkInfo:
  minSdkVersion: '24'
  targetSdkVersion: '29'
sharedLibrary: false
sparseResources: false
usesFramework:
  ids:
  - 1
  tag: null
version: 2.12.1
versionInfo:
  versionCode: '$VERSION_CODE'
  versionName: $VERSION_NAME
EOF

java -jar "$TOOLS/apktool.jar" b "$WORK" -o "$OUT/tamapoke-unsigned.apk"

# clé de signature : à GARDER (une mise à jour doit être signée par la même clé)
KS="$HERE/tamapoke-release.jks"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -noprompt -keystore "$KS" -storetype PKCS12 -storepass tamapoke \
    -keypass tamapoke -alias tamapoke -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=TamaPoke fan build, O=fLO"
fi
java -jar "$TOOLS/uber-apk-signer.jar" -a "$OUT/tamapoke-unsigned.apk" -o "$OUT" \
  --ks "$KS" --ksAlias tamapoke --ksPass tamapoke --ksKeyPass tamapoke --allowResign
mv -f "$OUT/tamapoke-aligned-signed.apk" "$OUT/TamaPoke-$VERSION_NAME.apk"
rm -f "$OUT/tamapoke-unsigned.apk"
ls -la "$OUT"
