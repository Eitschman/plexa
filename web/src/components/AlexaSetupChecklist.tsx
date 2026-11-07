import { getAlexaLocaleLabel } from '../lib/alexaLocales';
import {
  downloadInteractionModel,
  isValidInvocationName,
} from '../lib/generateInteractionModel';

const linkClass = 'text-accent underline';

export interface AlexaSetupChecklistProps {
  invocationName: string;
  locale: string;
  publicUrl?: string | null;
}

export function AlexaSetupChecklist({
  invocationName,
  locale,
  publicUrl,
}: AlexaSetupChecklistProps) {
  const localeLabel = getAlexaLocaleLabel(locale);
  const trimmedInvocation = invocationName.trim();
  const canDownload = isValidInvocationName(trimmedInvocation);
  const normalizedPublicUrl = publicUrl?.trim().replace(/\/$/, '') ?? '';

  return (
    <aside className="card space-y-3 p-6 text-sm">
      <h3 className="font-semibold">Alexa setup checklist</h3>
      <ol className="space-y-4 text-muted">
        <li>
          <strong className="text-foreground">Create skill.</strong>{' '}
          Open the{' '}
          <a className={linkClass} href="https://developer.amazon.com/alexa/console/ask" target="_blank" rel="noreferrer">
            Alexa Developer Console
          </a>
          , choose <strong className="text-foreground">Create Skill</strong> → <strong className="text-foreground">Custom</strong>,
          and select locale <strong className="text-foreground">{localeLabel}</strong> ({locale}).
          When prompted for a hosting service, choose <strong className="text-foreground">Provision your own</strong>{' '}
          (Plexa runs on your own HTTPS endpoint — see{' '}
          <a
            className={linkClass}
            href="https://developer.amazon.com/en-US/docs/alexa/host-a-custom-skill.html"
            target="_blank"
            rel="noreferrer"
          >
            Host a Custom Skill
          </a>
          ).
          Your Alexa device language must match this locale.
        </li>
        <li>
          <strong className="text-foreground">Enable Audio Player.</strong>{' '}
          Go to <strong className="text-foreground">Build</strong> →{' '}
          <a
            className={linkClass}
            href="https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-custom-skill-interfaces.html"
            target="_blank"
            rel="noreferrer"
          >
            Interfaces
          </a>
          , enable <strong className="text-foreground">Audio Player</strong> only, then click <strong className="text-foreground">Save Interfaces</strong>.
        </li>
        <li>
          <strong className="text-foreground">Import interaction model.</strong>{' '}
          Go to <strong className="text-foreground">Build</strong> → <strong className="text-foreground">Interaction Model</strong> →{' '}
          <a
            className={linkClass}
            href="https://developer.amazon.com/en-US/docs/alexa/custom-skills/custom-interaction-model-reference.html"
            target="_blank"
            rel="noreferrer"
          >
            JSON Editor
          </a>
          . Download the pre-filled file below, import or paste it, then click <strong className="text-foreground">Save Model</strong> and{' '}
          <strong className="text-foreground">Build Model</strong>.
          <div className="mt-2 space-y-2">
            <button
              type="button"
              className="btn btn-secondary text-sm"
              disabled={!canDownload}
              onClick={() => downloadInteractionModel(trimmedInvocation, locale)}
            >
              Download interaction model
            </button>
            <p className="text-xs">
              File includes invocation name <code>{trimmedInvocation || '…'}</code> and the{' '}
              <code>{locale}</code> interaction model. Import it into the same locale in the console.
            </p>
          </div>
        </li>
        <li>
          <strong className="text-foreground">Set endpoint.</strong>{' '}
          Go to <strong className="text-foreground">Endpoint</strong> → <strong className="text-foreground">HTTPS</strong>.
          Use your <strong className="text-foreground">Public HTTPS URL</strong> from the form above with <code>/alexa</code> appended
          (for example, <code>https://your-domain.example.com/alexa</code>).
          Do not include <code>/alexa</code> in the Public HTTPS URL field itself.
          {normalizedPublicUrl && (
            <p className="mt-2 text-xs">
              Your configured base URL: <code>{normalizedPublicUrl}</code> → endpoint:{' '}
              <code>{normalizedPublicUrl}/alexa</code>
            </p>
          )}
        </li>
        <li>
          <strong className="text-foreground">Skill ID and testing.</strong>{' '}
          Copy the Skill ID (<code>amzn1.ask.skill.…</code>) from the skill overview into the field above.
          Open the{' '}
          <a
            className={linkClass}
            href="https://developer.amazon.com/en-US/docs/alexa/devconsole/test-your-skill.html"
            target="_blank"
            rel="noreferrer"
          >
            Test
          </a>{' '}
          tab and enable <strong className="text-foreground">Development</strong> for your account.
        </li>
        <li>
          <strong className="text-foreground">Try it.</strong>{' '}
          Say: Alexa, ask <strong className="text-foreground">{trimmedInvocation || 'plexa'}</strong> to start my playlist.
        </li>
      </ol>
    </aside>
  );
}
