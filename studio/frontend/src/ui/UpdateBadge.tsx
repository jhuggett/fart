// The little window top right: a newer Uranus is out. Click to update;
// a bar while it lands; restart when it has.

import { update, applyUpdate, relaunch, dismissUpdate } from "../state/update.ts";

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
					<span class="what">
						Uranus <b>{info.latest}</b> is out
						<span class="sub"> · this is {info.current}</span>
					</span>
					{info.assetUrl ? (
						<button class="btn small" title={`download ${info.asset} (${mb(info.size)}) and replace this app`} onClick={() => void applyUpdate()}>
							Update
						</button>
					) : (
						<a class="btn small ghost" href={info.url} target="_blank" rel="noreferrer" title="the release has no build for this machine yet; see the release page">
							see release
						</a>
					)}
					<button class="btn x plain" title="not now" onClick={dismissUpdate}>
						×
					</button>
				</>
			) : phase === "done" ? (
				<>
					<span class="what">
						Uranus <b>{info.latest}</b> is installed
					</span>
					<button class="btn small" title="quit and start the new one" onClick={() => void relaunch()}>
						Restart
					</button>
				</>
			) : phase === "error" ? (
				<>
					<span class="what" style="color:var(--danger)" title={update.message.value}>
						update failed
						<span class="sub"> · {update.message.value.slice(0, 80)}</span>
					</span>
					<button class="btn small ghost" onClick={() => void applyUpdate()}>
						retry
					</button>
					<a class="btn small ghost" href={info.url} target="_blank" rel="noreferrer">
						release
					</a>
					<button class="btn x plain" title="not now" onClick={dismissUpdate}>
						×
					</button>
				</>
			) : (
				<>
					<span class="what">
						{phase === "download" ? `downloading ${update.total.value ? pct + "%" : mb(update.done.value)}` : phase === "unpack" ? "unpacking" : "installing"}
					</span>
					<span class="bar">
						<span class="fill" style={{ width: `${phase === "download" ? pct : 100}%` }} />
					</span>
				</>
			)}
		</div>
	);
}
