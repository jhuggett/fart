# fastart: the shortcuts. `make` lists them.
#
#   make setup      once: npm deps + the Wails CLI
#   make dev        the studio with live reload
#   make app        build studio/bin/Uranus.app (or bin/Uranus elsewhere)
#   make run        build it, then open it
#   make install    build it into ~/Applications/Uranus.app (pin that to the Dock; every install replaces it in place)
#   make release V=0.4.0   bump, tag, push, build the universal bundle, publish it on GitHub, install it
#   make serve DIR=path/to/art      the LAN server only, no window (try DIR=examples/space)
#   make test       every check: core, corpus, Odin loader, studio
#   make check-save the save model, end to end, in a headless browser (needs the app built)
#   make validate DIR=path/to/art   fart validate
#   make skill      install the fastart skill for Claude Code (~/.claude/skills)

SHELL := /bin/sh
export PATH := $(shell go env GOPATH)/bin:$(PATH)
DIR ?= spec/examples
UNAME := $(shell uname)

.PHONY: help setup dev app run serve test validate skill install check-save release clean

help:
	@sed -n 's/^#   //p' Makefile

setup:
	npm install
	go install github.com/wailsapp/wails/v3/cmd/wails3@latest

dev: node_modules
	cd studio && wails3 dev

app: node_modules
	rm -f studio/bin/Uranus # a universal build leaves a fat binary go build refuses to overwrite
	cd studio && wails3 task package

# a running studio would just take the launch (single instance): quit it first
run: app
ifeq ($(UNAME),Darwin)
	-pkill -x Uranus
	open studio/bin/Uranus.app
else
	./studio/bin/Uranus
endif

# the bundle lands at one stable path, updated in place, so a Dock pin
# and the Finder's "open with" keep pointing at the newest build
INSTALLED := $(HOME)/Applications/Uranus.app
install: app
ifeq ($(UNAME),Darwin)
	mkdir -p "$(HOME)/Applications"
	-pkill -x Uranus
	rsync -a --delete studio/bin/Uranus.app/ "$(INSTALLED)/"
	touch "$(INSTALLED)"
	@echo "installed: $(INSTALLED)  (drag it to the Dock once; make install again to update)"
else
	@echo "install is for macOS; the binary is studio/bin/Uranus"
endif

serve: node_modules
	cd studio && wails3 task build
	./studio/bin/Uranus --serve $(DIR)

test: node_modules
	npm run check -w @fastart/core
	npm test -w @fastart/core
	odin test loaders/odin/test
	npm run check -w @fastart/studio
	npm run build -w @fastart/studio
	cd studio && go vet ./...

# a studio release, end to end (see scripts/release.sh)
release: node_modules
	sh scripts/release.sh $(V)

# the file on disk is the document: edits land, ⌘S checkpoints, nothing reverts alone
check-save: node_modules
	cd studio && go build -o bin/studio .
	npx playwright install chromium >/dev/null 2>&1 || true
	node studio/test/save.mjs

validate: node_modules
	node packages/core/src/cli.ts validate $(DIR)

# the skill names this checkout, so agents in other projects find the tools
skill:
	mkdir -p $(HOME)/.claude/skills/fastart
	sed 's#{{FASTART}}#$(CURDIR)#g' skills/fastart/SKILL.md > $(HOME)/.claude/skills/fastart/SKILL.md
	@echo "installed ~/.claude/skills/fastart (run again after pulling)"

clean:
	rm -rf studio/bin studio/frontend/dist packages/core/dist

node_modules: package.json package-lock.json
	npm install
	@touch node_modules
