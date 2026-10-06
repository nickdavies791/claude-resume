#!/bin/sh
# Stands in for `claude` in the demo recording.
o='\033[38;2;215;119;87m'; d='\033[2m'; b='\033[1m'; g='\033[32m'; r='\033[0m'
clear
printf "\n ${o}✻${r} Welcome back to ${b}Claude Code${r}\n   ${d}cwd: ~/%s${r}\n\n" "${PWD#$HOME/}"
printf " ${d}>${r} Stripe is sending some webhooks twice and we create two invoices\n\n"
printf " ${g}●${r} The webhook handler should be idempotent, so store the event id\n   before processing and skip events we have already seen.\n\n"
printf " ${d}╭──────────────────────────────────────────────────────────────────────╮${r}\n"
printf " ${d}│${r} > %-67s${d}│${r}\n" ""
printf " ${d}╰──────────────────────────────────────────────────────────────────────╯${r}\n"
sleep 30
