"""Creates fake Claude Code sessions for the demo recording."""
import json, os, sys, time, uuid
from datetime import datetime, timezone

root = sys.argv[1]
home = os.path.join(root, 'home')
now = time.time()

SESSIONS = [
    ('Code/billing-api', 'fix/webhook-retries', 'Fix duplicate Stripe webhook deliveries', 'Stripe is sending some webhooks twice and we create two invoices', 'The webhook handler should be idempotent, so store the event id before processing.', 0.05),
    ('Code/web', 'feat/dark-mode', 'Add dark mode to settings page', 'Add a dark mode toggle to the settings page', 'I added a theme toggle that saves to local storage.', 3),
    ('Code/mobile-app', 'main', 'Push notification permissions on iOS', 'Notifications never prompt for permission on iOS 18', 'The permission request runs before the app is active.', 26),
    ('Code/billing-api', 'main', 'Monthly invoice PDF layout', 'The invoice PDF cuts off long line items', 'Long descriptions now wrap instead of overflowing.', 50),
    ('Code/infra', 'main', 'Terraform plan for new Redis cluster', 'Plan a Redis cluster for the queue workers', 'Here is the plan for a 3 node cluster.', 75),
    ('Personal/side-project', 'main', 'Set up Astro blog with MDX', 'Set up a blog with Astro and MDX', 'The blog is running at localhost:4321.', 120),
    ('Code/web', 'main', 'Payments dashboard refactor', 'Split the payments dashboard into smaller components', 'Failed webhook events now show in a separate table on the dashboard.', 170),
    ('Code/data-pipeline', 'main', 'Speed up nightly export job', 'The nightly export takes four hours', 'Batching the inserts brings it down to 20 minutes.', 300),
    ('Code/mobile-app', 'release/2.4', 'Release notes for 2.4', 'Write release notes for 2.4', 'Here are the release notes.', 400),
]

for rel, branch, title, prompt, reply, hours in SESSIONS:
    cwd = os.path.join(home, rel)
    os.makedirs(cwd, exist_ok=True)
    proj = os.path.join(root, 'claude', 'projects', cwd.replace('/', '-'))
    os.makedirs(proj, exist_ok=True)
    sid = str(uuid.uuid4())
    ts = datetime.fromtimestamp(now - hours * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')
    base = {'sessionId': sid, 'cwd': cwd, 'gitBranch': branch, 'timestamp': ts, 'isSidechain': False}
    lines = [
        {**base, 'type': 'user', 'message': {'role': 'user', 'content': prompt}, 'origin': {'kind': 'human'}},
        {**base, 'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': reply + ' ' + 'Detail. ' * 400}]}},
        {'type': 'ai-title', 'aiTitle': title, 'sessionId': sid},
    ]
    path = os.path.join(proj, sid + '.jsonl')
    with open(path, 'w') as f:
        f.write('\n'.join(json.dumps(l, separators=(',', ':')) for l in lines) + '\n')
    os.utime(path, (now - hours * 3600, now - hours * 3600))
