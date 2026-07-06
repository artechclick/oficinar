# Publicar Oficinar en la Microsoft Store

El paquete para la Store se genera con:

```bash
npm run dist:store
```

Esto produce **`dist/Oficinar 1.0.0.appx`** (paquete APPX sin firmar: la Store lo firma al publicarlo).

## Paso 1 — Cuenta de desarrollador

Necesitas una cuenta en **Microsoft Partner Center** (https://partner.microsoft.com/dashboard):
cuota única de ~19 USD (individual) o ~99 USD (empresa).

## Paso 2 — Reservar el nombre de la app

En Partner Center → **Apps y juegos → Nueva app** → reserva el nombre **Oficinar**
(si está libre). Al reservarlo, en **Administración de productos → Identidad de la app**
obtendrás TRES valores que debes copiar:

| Valor de Partner Center | Ejemplo | Dónde va en `package.json` (`build.appx`) |
|---|---|---|
| **Package/Identity/Name** | `12345ARTECHCLICK.Oficinar` | `identityName` |
| **Package/Identity/Publisher** | `CN=ABCDEF12-3456-7890-ABCD-EF1234567890` | `publisher` |
| **Package/Properties/PublisherDisplayName** | `ARTECH CLICK` | `publisherDisplayName` |

> ⚠️ Los valores actuales del `package.json` (`ARTECHCLICK.Oficinar`, `CN=ARTECH CLICK`)
> son **provisionales**. Si no los reemplazas por los exactos de Partner Center,
> la Store **rechazará** la subida.

## Paso 3 — Regenerar el paquete con la identidad correcta

Edita `package.json` → `build.appx` con los tres valores reales y vuelve a ejecutar:

```bash
npm run dist:store
```

## Paso 4 — Subir a la Store

En Partner Center → tu app → **Envíos → Paquetes** → arrastra el `.appx` generado.
Completa la ficha (descripción, capturas, categoría *Productividad*, clasificación por edades,
precio) y envía a certificación. Microsoft firma y valida el paquete automáticamente.

## Notas técnicas

- **Firma**: no se firma localmente (es correcto: `AppX is not signed — Windows Store only build`).
  La Store aplica su propia firma. Para *probar el .appx en tu PC* antes de subirlo,
  tendrías que firmarlo con un certificado propio y activar el Modo de desarrollador.
- **Versión**: sube el número en `package.json` (`version`) en cada envío nuevo.
- **Iconos/mosaicos**: se generan automáticamente desde `build/icon.png` (el anillo de vidrio
  con transparencia) sobre el color de mosaico `#1a1030`.
- **Windows mínimo**: 10.0.14316 (Windows 10 1607+).
- El paquete pesa ~174 MB porque incluye el runtime de Electron.
