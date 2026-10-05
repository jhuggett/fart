// The sheets that ask for more than one thing before something can
// happen: a new project, a clone, a new asset, a branch, a commit. Each
// validates as it is typed and names its primary button with the verb.

import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { project, createProjectAt, cloneProject, newFile, newModel, newPalette, newScene, newBranch, commitAll, placed, ASSET_NAME, NAME_HINT, type Starter } from "../state/project.ts";
import { openSheet, closeSheet } from "../state/prompt.ts";
import { shell } from "../shell/shell.ts";
import { pretty } from "../state/paths.ts";
import { nav } from "../state/nav.ts";
import { Sheet, TextField, SegmentedControl, Checkbox, Button, SidebarRow, middleTruncate } from "./ur.tsx";

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
const HOME_KEY = "fastart.projects.home";
/** where the last project was made or cloned: the next one starts there */
const lastParent = signal(
	(() => {
		try {
			return localStorage.getItem(HOME_KEY) ?? "";
		} catch {
			return "";
		}
	})(),
);
function keepParent(p: string) {
	lastParent.value = p;
	try {
		localStorage.setItem(HOME_KEY, p);
	} catch {
		// lasts the session
	}
}

/** The location row: where the folder goes, and the platform's dialog to change it. */
function Location({ label, value, title, onPick }: { label: string; value: string; title: string; onPick: (p: string) => void }) {
	return (
		<TextField
			label={label}
			mono
			readOnly
			value={value ? middleTruncate(pretty(value, project.home.value), 46) : ""}
			placeholder="No folder chosen"
			trailing={
				<Button
					onClick={() =>
						void shell.pickFolderAt(title, "Choose").then((p) => {
							if (p) onPick(p);
						})
					}
				>
					Choose…
				</Button>
			}
		/>
	);
}

function CreateProject() {
	const [name, setName] = useState("");
	const [parent, setParent] = useState(lastParent.value);
	const [start, setStart] = useState<Starter>("Empty");
	const [repo, setRepo] = useState(true);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const bad = name.trim() !== "" && !PROJECT_NAME.test(name.trim());
	const create = () => {
		setBusy(true);
		keepParent(parent);
		createProjectAt(parent, name.trim(), start, repo).then(closeSheet, (e) => {
			setBusy(false);
			setErr(String(e).replace(/^Error: /, ""));
		});
	};
	return (
		<Sheet
			title="Create new project"
			message="A project is a folder: Uranus makes it, with assets/ inside."
			onClose={closeSheet}
			footnote={err || undefined}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Create", primary: true, disabled: busy || !name.trim() || bad || !parent, onClick: create },
			]}
		>
			<TextField label="Name" value={name} autoFocus invalid={bad} hint={bad ? "Use letters, numbers, spaces, . - and _, starting with a letter or number." : "The folder takes this name."} onChange={(v) => (setName(v), setErr(""))} />
			<Location label="Location" value={parent} title="Where should the project live?" onPick={setParent} />
			<div class="ur-tf-wrap">
				<span class="ur-tf-label">Start with</span>
				<SegmentedControl options={["Empty", "2D", "3D"]} value={start} onChange={setStart} label="Start with" />
			</div>
			<Checkbox checked={repo} onChange={setRepo} label="Create a git repository" />
		</Sheet>
	);
}
export const createProjectSheet = () => openSheet(() => <CreateProject />);

const GIT_URL = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|\/|~\/).+/;

function Clone() {
	const [url, setUrl] = useState("");
	const [parent, setParent] = useState(lastParent.value);
	const [busy, setBusy] = useState<{ message: string; done: number | null } | null>(null);
	const [err, setErr] = useState("");
	const bad = url.trim() !== "" && !GIT_URL.test(url.trim());
	const clone = () => {
		setBusy({ message: "Starting", done: null });
		setErr("");
		keepParent(parent);
		cloneProject(url.trim(), parent, (message, done) => setBusy({ message, done })).then(closeSheet, (e) => {
			setBusy(null);
			setErr(String(e).replace(/^Error: /, ""));
		});
	};
	return (
		<Sheet
			title="Clone git repository"
			message="Check a project out from a remote, then open it."
			onClose={() => !busy && closeSheet()}
			footnote={
				busy ? (
					<span class="ur-progress">
						<span class="ur-activity-bar">
							<i style={{ width: `${Math.round((busy.done ?? 0.15) * 100)}%` }} />
						</span>
						{busy.message}
					</span>
				) : (
					err || undefined
				)
			}
			actions={[
				{ label: "Cancel", disabled: !!busy, onClick: closeSheet },
				{ label: "Clone", primary: true, disabled: !!busy || !url.trim() || bad || !parent, onClick: clone },
			]}
		>
			<TextField label="Repository URL" mono value={url} autoFocus invalid={bad} placeholder="https://github.com/you/art.git" hint={bad ? "That is not a URL git can clone." : "An https, ssh or file URL."} onChange={(v) => (setUrl(v), setErr(""))} />
			<Location label="Destination" value={parent} title="Where should the clone go?" onPick={setParent} />
		</Sheet>
	);
}
export const cloneSheet = () => openSheet(() => <Clone />);

export type NewKind = "2D" | "3D" | "Palette" | "Scene" | "3D scene";

/** The path a new asset of a kind would take, the way the project places it. */
function pathFor(kind: NewKind, folder: string, name: string): string {
	const inFolder = folder ? `${folder}/${name}` : name;
	if (kind === "Scene" || kind === "3D scene") return placed(`${inFolder}.shart`);
	if (kind === "Palette") return `${folder ? inFolder : placed(`palettes/${name}`)}.fart`;
	return placed(`${inFolder}.fart`);
}

function NewAsset({ kind: kind0, folder, open, done }: { kind: NewKind; folder: string; open: boolean; done: (rel: string | null) => void }) {
	const [kind, setKind] = useState<NewKind>(kind0);
	const [name, setName] = useState("");
	const n = name.trim();
	const rel = n ? pathFor(kind, folder, n) : "";
	const bad = n === "" ? null : !ASSET_NAME.test(n) ? NAME_HINT : project.files.value.includes(rel) ? `${n} already exists there.` : null;
	const cancel = () => (closeSheet(), done(null));
	const create = async () => {
		closeSheet();
		const at = folder ? `${folder}/${n}` : n;
		if (kind === "Palette") return done(await newPalette(at, open));
		if (kind === "2D") await newFile(at);
		else if (kind === "3D") await newModel(at);
		else await newScene(at, kind === "3D scene");
		done(rel);
	};
	return (
		<Sheet
			title="New asset"
			message={rel ? `It lands at ${rel}.` : folder ? `In ${folder}/.` : undefined}
			onClose={cancel}
			actions={[
				{ label: "Cancel", onClick: cancel },
				{ label: "Create", primary: true, disabled: !n || !!bad, onClick: () => void create() },
			]}
		>
			<TextField label="Name" mono value={name} autoFocus invalid={!!bad} hint={bad ?? NAME_HINT} onChange={setName} />
			<div class="ur-tf-wrap">
				<span class="ur-tf-label">Kind</span>
				<SegmentedControl options={["2D", "3D", "Palette", "Scene", "3D scene"]} value={kind} onChange={setKind} label="Kind" />
			</div>
		</Sheet>
	);
}

/** New asset…: resolves with the file's path, or null. `folder` defaults to where the browser is. */
export function newAssetSheet(kind: NewKind = "2D", folder: string = nav.folder.value, open = true): Promise<string | null> {
	return new Promise((resolve) => openSheet(() => <NewAsset kind={kind} folder={folder} open={open} done={resolve} />));
}

const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]+(?<![./])$/;

function NewBranch() {
	const [name, setName] = useState("");
	const n = name.trim();
	const bad = n === "" ? null : !BRANCH.test(n) ? "Use letters, numbers, / . - and _." : project.branches.value.includes(n) ? `${n} already exists.` : null;
	return (
		<Sheet
			title="New branch"
			message={`From ${project.branch.value || "here"}. Uranus switches to it.`}
			onClose={closeSheet}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Create", primary: true, disabled: !n || !!bad, onClick: () => (closeSheet(), void newBranch(n)) },
			]}
		>
			<TextField label="Name" mono value={name} autoFocus invalid={!!bad} hint={bad ?? "Use letters, numbers, / . - and _."} onChange={setName} />
		</Sheet>
	);
}
export const newBranchSheet = () => openSheet(() => <NewBranch />);

function Commit() {
	const [msg, setMsg] = useState("");
	const changes = project.changes.value;
	return (
		<Sheet
			title="Review and commit"
			message={`${changes.length} change${changes.length === 1 ? "" : "s"} on ${project.branch.value}. Everything listed is committed.`}
			width={480}
			onClose={closeSheet}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Commit", primary: true, disabled: !msg.trim() || !changes.length, onClick: () => (closeSheet(), void commitAll(msg.trim())) },
			]}
		>
			<div class="ur-tree ur-sheet-list">
				{changes.map((c) => (
					<SidebarRow key={c.path} label={c.path} icon="file" badge={c.status} title={c.path} />
				))}
			</div>
			<TextField label="Message" value={msg} autoFocus placeholder="What changed" onChange={setMsg} />
		</Sheet>
	);
}
export const commitSheet = () => openSheet(() => <Commit />);
