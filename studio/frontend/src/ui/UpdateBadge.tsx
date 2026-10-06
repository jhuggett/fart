// The little window top right: a newer Uranus is out. Click to update;
// a bar while it lands; restart when it has.

import { update, applyUpdate, relaunch, dismissUpdate } from "../state/update.ts";
import { Button, Icon } from "./ur.tsx";

export function UpdateBadge() {
	const info = update.info.value;
	const phase = update.phase.value;
	if (!info?.available || update.dismissed.value) return null;
	const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
	const pct = update.total.value > 0 ? Math.min(100, Math.round((update.done.value / update.total.value) * 100)) : 0;
	return (
		<div class="update" role="status">
			{phase === "idle" || phase === "checking" ? (
				<>
					<Icon name="download" />
					<span class="what">
						Uranus <b>{info.latest}</b> is out
						<span class="sub"> · this is {info.current}</span>
					</span>
					{info.assetUrl ? (
						<Button variant="primary" title={`Download ${info.asset} (${mb(info.size)}) and replace this app`} onClick={() => void applyUpdate()}>
							Update
						</Button>
					) : (
						<a class="ur-btn" href={info.url} target="_blank" rel="noreferrer" title="The release has no build for this machine yet; see the release page">
							See release
						</a>
					)}
					<Button variant="borderless" title="Not now" onClick={dismissUpdate}>
						Not now
					</Button>
				</>
			) : phase === "done" ? (
				<>
					<Icon name="circle-check" class="update-ok" />
					<span class="what">
						Uranus <b>{info.latest}</b> is installed
					</span>
					<Button variant="primary" title="Quit and start the new one" onClick={() => void relaunch()}>
						Restart
					</Button>
				</>
			) : phase === "error" ? (
				<>
					<Icon name="triangle-alert" class="ur-danger" />
					<span class="what" title={update.message.value}>
						Update failed
						<span class="sub"> · {update.message.value.slice(0, 80)}</span>
					</span>
					<Button onClick={() => void applyUpdate()}>Retry</Button>
					<a class="ur-btn" href={info.url} target="_blank" rel="noreferrer">
						Release
					</a>
					<Button variant="borderless" title="Not now" onClick={dismissUpdate}>
						Not now
					</Button>
				</>
			) : (
				<>
					<span class="what">{phase === "download" ? `Downloading ${update.total.value ? pct + "%" : mb(update.done.value)}` : phase === "unpack" ? "Unpacking" : "Installing"}</span>
					<span class="bar">
						<span class="fill" style={{ width: `${phase === "download" ? pct : 100}%` }} />
					</span>
				</>
			)}
		</div>
	);
}
