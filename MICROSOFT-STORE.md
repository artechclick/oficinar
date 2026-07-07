# Publicar Oficinar en la Microsoft Store

El paquete para la Store se genera **en un PC con Windows** con:

```bash
npm ci
npm run dist:store
```

Esto produce **`dist/Oficinar <versión>.appx`** (paquete APPX x64 sin firmar: la Store lo firma al publicarlo).

> ⚠️ El destino `appx` no se puede compilar en macOS (electron-builder exige Parallels
> Desktop con una VM de Windows). Si al compilar en Windows aparece `makeappx.exe not found`,
> instala el **Windows 10/11 SDK** (`winget install Microsoft.WindowsSDK.10.0.22621`).

## Paso 1 — Cuenta de desarrollador

Necesitas una cuenta en **Microsoft Partner Center** (https://partner.microsoft.com/dashboard):
cuota única de ~19 USD (individual) o ~99 USD (empresa).

## Identidad (ya configurada)

El `package.json` → `build.appx` ya tiene la identidad real de esta cuenta de
Partner Center:

| Valor | Contenido |
|---|---|
| `identityName` | `ArtechClick.Oficinar` |
| `publisher` | `CN=217692EE-5B79-4ED6-A1F6-BA0D38A99632` |
| `publisherDisplayName` | `Artech Click` |
| `applicationId` | `ArtechClick.Oficinar` |

Si en el futuro publicas con OTRA cuenta, reemplaza estos tres valores por los que
aparecen en Partner Center → **Administración de productos → Identidad de la app**.

## Paso 2 — Subir a la Store

En Partner Center → tu app → **Envíos → Paquetes** → arrastra el `.appx` generado.
Completa la ficha (descripción, capturas, categoría *Productividad*, clasificación por edades,
precio) y envía a certificación. Microsoft firma y valida el paquete automáticamente.

## Notas técnicas

- **Firma**: no se firma localmente (es correcto: `AppX is not signed — Windows Store only build`).
  La Store aplica su propia firma. Para *probar el .appx en tu PC* antes de subirlo,
  tendrías que firmarlo con un certificado propio y activar el Modo de desarrollador.
- **Versión**: sube el número en `package.json` (`version`) en cada envío nuevo.
- **Iconos/mosaicos**: se incluyen en `build/appx/` (Square 44/71/150/310, Wide 310x150,
  StoreLogo 50 y SplashScreen 620x300), generados desde `recursos/logo.png` con transparencia,
  sobre el color de mosaico `#1a1030`. Se puede regenerar con el script del repositorio.
- **Windows mínimo**: 10.0.14316 (Windows 10 1607+).
- El paquete pesa ~174 MB porque incluye el runtime de Electron.
