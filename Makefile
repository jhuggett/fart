# fastart: the shortcuts. `make` lists them.
#
#   make setup      once: npm deps + the Wails CLI
#   make dev        the studio with live reload
#   make app        build studio/bin/studio.app (or bin/studio elsewhere)
#   make run        build it, then open it
#   make serve DIR=path/to/art      the LAN server only, no window (try DIR=examples/space)
#   make test       every check: core, corpus, Odin loader, studio
#   make validate DIR=path/to/art   fart validate

SHELL := /bin/sh
export PATH := $(shell go env GOPATH)/bin:$(PATH)
DIR ?= spec/examples
UNAME := $(shell uname)

.PHONY: help setup dev app run serve test validate clean

help:
	@sed -n 's/^#   //p' Makefile

setup:
	npm install
	go install github.com/wailsapp/wails/v3/cmd/wails3@latest

dev: node_modules
	cd studio && wails3 dev

app: node_modules
	cd studio && wails3 task package

# a running studio would just take the launch (single instance): quit it first
run: app
ifeq ($(UNAME),Darwin)
	-pkill -x studio
	open studio/bin/studio.app
else
	./studio/bin/studio
endif

serve: node_modules
	cd studio && wails3 task build
	./studio/bin/studio --serve $(DIR)

test: node_modules
	npm run check -w @fastart/core
	npm test -w @fastart/core
	odin test loaders/odin/test
	npm run check -w @fastart/studio
	npm run build -w @fastart/studio
	cd studio && go vet ./...

validate: node_modules
	node packages/core/src/cli.ts validate $(DIR)

clean:
	rm -rf studio/bin studio/frontend/dist packages/core/dist

node_modules: package.json package-lock.json
	npm install
	@touch node_modules
