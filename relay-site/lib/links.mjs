export function approvalLink(fragment) {
  const values = new URLSearchParams(fragment.replace(/^#/, ''));
  if (values.getAll('message').length !== 1)
    throw Error('Open a fresh approval link from the pull request.');
  const message = values.get('message');
  if (
    !message ||
    new TextEncoder().encode(message).length > 4096 ||
    !message.startsWith(
      'Approve this GitHub pull request\n\nRepository: dionysuzx/tempo-human-approval-demo\n',
    )
  )
    throw Error('Invalid approval request.');
  const match = message.match(/^Pull request: #([1-9][0-9]{0,8})$/m);
  if (!match) throw Error('Invalid pull request.');
  // Drop caller-controlled delivery and return parameters entirely.
  const clean = new URLSearchParams({ message }).toString();
  const mac = new URL('http://localhost:8787/native');
  mac.hash = new URLSearchParams({
    message,
    delivery: 'github-demo',
    deliver: 'http://localhost:8792/deliver',
  }).toString();
  return {
    message,
    fragment: clean,
    macURL: mac.href,
    githubURL: `https://github.com/dionysuzx/tempo-human-approval-demo/pull/${match[1]}`,
  };
}
