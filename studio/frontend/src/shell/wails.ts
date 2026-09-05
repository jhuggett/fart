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
	async caps() {
		const c = await Project.Caps();
		return { trash: !!c.trash, reveal: c.reveal ?? "" };
	}
	removeFile(root: string, rel: string) {
		return Project.Remove(root, rel);
	}
	renameFile(root: string, from: string, to: string) {
		return Project.Rename(root, from, to);
	}
	duplicateFile(root: string, rel: string) {
		return Project.Duplicate(root, rel);
	}
	revealFile(root: string, rel: string) {
		return Project.Reveal(root, rel);
	}
	readonly setup = true;
	gitRoot(dir: string) {
		return Project.GitRoot(dir);
	}
	checkout() {
		return Project.Checkout();
	}
	async readAt(base: string, rel: string) {
		const t = await Project.ReadAt(base, rel);
		return t.found ? t.text : null;
	}
	writeAt(base: string, rel: string, text: string) {
		return Project.WriteAt(base, rel, text);
	}
	async findNamed(base: string, name: string) {
		return (await Project.FindNamed(base, name)) ?? [];
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
	log(msg: string) {
		console.log(msg);
		void Project.Log(msg).catch(() => {});
	}
	onMenu(cb: (id: string) => void) {
		Events.On("menu", (ev: { data: string }) => cb(ev.data));
	}
}
