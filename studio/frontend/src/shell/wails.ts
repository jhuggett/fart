// The desktop face of the shell: the Go ProjectService over Wails
// bindings. Only ever imported inside the app (see shell.ts).

import * as Project from "../../bindings/studio/projectservice.js";
import { Events } from "@wailsio/runtime";
import type { Shell } from "./shell.ts";

export class WailsShell implements Shell {
	readonly kind = "wails" as const;
	async pickFolder() {
		const p = await Project.PickFolder();
		return p || null;
	}
	isDir(path: string) {
		return Project.IsDir(path);
	}
	home() {
		return Project.Home();
	}
	defaultRoot() {
		return Project.DefaultRoot();
	}
	async listFiles(root: string) {
		return (await Project.ListFiles(root)) ?? [];
	}
	async readFile(root: string, rel: string) {
		try {
			return await Project.ReadFile(root, rel);
		} catch {
			return null;
		}
	}
	writeFile(root: string, rel: string, text: string) {
		return Project.WriteFile(root, rel, text);
	}
	async recents() {
		return (await Project.Recents()) ?? [];
	}
	async pushRecent(root: string) {
		return (await Project.PushRecent(root)) ?? [];
	}
	async forgetRecent(root: string) {
		return (await Project.ForgetRecent(root)) ?? [];
	}
	async drainOpenQueue() {
		return (await Project.DrainOpenQueue()) ?? [];
	}
	onOpenFiles(cb: () => void) {
		Events.On("open-files", () => cb());
	}
	serve(root: string) {
		return Project.Serve(root);
	}
	serveStatus() {
		return Project.ServeStatus();
	}
	serveStop() {
		return Project.ServeStop();
	}
	async info() {
		return { name: "" };
	}
}
