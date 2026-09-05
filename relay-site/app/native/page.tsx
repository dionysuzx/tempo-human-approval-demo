'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { approvalLink } from '@/lib/links.mjs';
export default function ApprovalPage() {
  const [request, setRequest] = useState<ReturnType<
    typeof approvalLink
  > | null>(null);
  const [installURL, setInstallURL] = useState('');
  const [mobile, setMobile] = useState(false),
    [status, setStatus] = useState(''),
    [url, setURL] = useState(''),
    [standalone, setStandalone] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMobile(
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
      );
      setStandalone(matchMedia('(display-mode: standalone)').matches);
      try {
        const value = approvalLink(location.hash);
        setRequest(value);
        setURL(location.origin + '/native#' + value.fragment);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Invalid link');
      }
      void fetch('/distribution.json')
        .then((r) => r.json())
        .then((value) => {
          if (
            value &&
            typeof value === 'object' &&
            'installURL' in value &&
            typeof value.installURL === 'string' &&
            /^https:\/\/(testflight\.apple\.com\/join\/[A-Za-z0-9]+|apps\.apple\.com\/[A-Za-z0-9/_-]+)$/.test(
              value.installURL,
            )
          )
            setInstallURL(value.installURL);
        })
        .catch(() => {});
      if ('serviceWorker' in navigator)
        void navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main>
      <p className="eyebrow">TEMPO / HUMAN APPROVAL</p>
      <h1>
        {request ? 'Review. Approve. Return.' : 'Your approval, on iPhone.'}
      </h1>
      {request && (
        <>
          <section>
            <h2>Approval request</h2>
            <pre>{request.message}</pre>
            <a href={request.githubURL}>Review the pull request ↗</a>
          </section>
          {mobile ? (
            <section>
              <h2>Continue in the Face ID app</h2>
              <p>
                If installed and associated with this domain, the original link
                can open the app directly. If this page opened instead,
                long-press the original link in GitHub and choose the app when
                offered, or copy this link into the app.
              </p>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setStatus(
                      'Copied. Open Tempo Approval and paste the link.',
                    );
                  } catch {
                    setStatus('Select and copy the link below.');
                  }
                }}
              >
                Copy approval link
              </Button>
              <input aria-label="Approval link" readOnly value={url} />
              <p>
                The app returns you to GitHub after confirmed proof delivery.
              </p>
            </section>
          ) : (
            <section>
              <h2>Continue on your Mac</h2>
              <p>
                Keep Native Signing Bridge and its local delivery service
                running.
              </p>
              <a className="primary" href={request.macURL}>
                Open Mac approval
              </a>
            </section>
          )}
        </>
      )}
      <section>
        <h2>Install on iPhone</h2>
        {installURL ? (
          <a className="primary" href={installURL}>
            Install the Face ID app
          </a>
        ) : (
          <p>
            The native Face ID app needs an Apple-signed build. Distribution is
            not configured yet.
          </p>
        )}
        {!standalone && (
          <p>
            To save this web entry: in Safari, open Share → Add to Home Screen →
            keep Open as Web App enabled → Add.
          </p>
        )}
        {standalone && <p>You are using the Home Screen web entry.</p>}
        <p>
          The web entry does not sign approvals. A passkey prompt may use Face
          ID or a device passcode; this native app protects signing with the
          current Face ID enrollment.
        </p>
      </section>
      <output aria-live="polite">{status}</output>
    </main>
  );
}
