#!/bin/zsh
# Retención semanal de fotos de averías (90 días) desde el Mac del operador.
#
# Lo lanza launchd (scripts/launchd/com.blindbeds.relevo.purge-photos.plist).
# Ejecuta scripts/purge-ticket-photos.mjs --apply con el .env.local del repo
# (necesita SUPABASE_SERVICE_ROLE_KEY) y avisa SIEMPRE con una notificación:
# un respaldo/purga mudo no es una purga.
#
# Prueba manual sin borrar nada:  DRY=1 scripts/launchd/purge-ticket-photos-weekly.sh
set -u
REPO="${0:A:h:h:h}"
LOG="$HOME/Library/Logs/relevo-purge-photos.log"
NODE="${NODE:-$HOME/.local/bin/node}"
APPLY="--apply"
[[ "${DRY:-0}" == "1" ]] && APPLY=""

notify() {
  /usr/bin/osascript -e "display notification \"$2\" with title \"Relevo · retención de fotos\" subtitle \"$1\"" >/dev/null 2>&1
}

cd "$REPO" || { notify "ERROR" "No encuentro el repo en $REPO"; exit 1; }
if [[ ! -f .env.local ]]; then
  notify "ERROR" "Falta .env.local en el repo"
  exit 1
fi

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ${APPLY:-simulación}"
  OUT=$("$NODE" --env-file=.env.local scripts/purge-ticket-photos.mjs ${APPLY} 2>&1)
  RC=$?
  echo "$OUT"
  echo "rc=$RC"
} >>"$LOG" 2>&1

LAST=$(tail -n 40 "$LOG")
RC=$(print -r -- "$LAST" | grep -o 'rc=[0-9]*' | tail -1 | cut -d= -f2)
SUMMARY=$(print -r -- "$LAST" | grep -E '^(Partes cerrados|Hecho|Huérfanas|Error|Lote)' | tail -1)
if [[ "$RC" == "0" ]]; then
  notify "OK" "${SUMMARY:-sin salida}"
else
  notify "ERROR (rc=$RC)" "${SUMMARY:-mira $LOG}"
fi
exit "${RC:-1}"
