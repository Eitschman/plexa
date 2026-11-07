import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlexaSetupChecklist } from './AlexaSetupChecklist';

vi.mock('../lib/generateInteractionModel', () => ({
  downloadInteractionModel: vi.fn(),
  isValidInvocationName: vi.fn((name: string) => name.trim().length >= 2),
}));

import { downloadInteractionModel } from '../lib/generateInteractionModel';

describe('AlexaSetupChecklist', () => {
  it('renders download button and key links', () => {
    render(
      <AlexaSetupChecklist
        invocationName="plexa"
        locale="en-US"
        publicUrl="https://example.com"
      />,
    );

    expect(screen.getByRole('heading', { name: /alexa setup checklist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download interaction model/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /alexa developer console/i })).toHaveAttribute(
      'href',
      'https://developer.amazon.com/alexa/console/ask',
    );
    expect(screen.getByRole('link', { name: /interfaces/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /json editor/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^test$/i })).toBeInTheDocument();
  });

  it('shows generic endpoint instruction in primary text', () => {
    render(
      <AlexaSetupChecklist
        invocationName="plexa"
        locale="en-US"
        publicUrl="https://composition-teachers-breeding-suddenly.trycloudflare.com"
      />,
    );

    const endpointStep = screen.getByText('Set endpoint.').closest('li');
    expect(endpointStep).toHaveTextContent('Public HTTPS URL');
    expect(endpointStep).toHaveTextContent('https://your-domain.example.com/alexa');
  });

  it('shows configured endpoint helper when publicUrl is set', () => {
    render(
      <AlexaSetupChecklist
        invocationName="plexa"
        locale="en-US"
        publicUrl="https://example.com/"
      />,
    );

    expect(screen.getByText(/your configured base url/i)).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/alexa')).toBeInTheDocument();
  });

  it('shows selected locale label in step 1', () => {
    render(
      <AlexaSetupChecklist
        invocationName="plexa"
        locale="en-GB"
      />,
    );

    const createSkillStep = screen.getByText('Create skill.').closest('li');
    expect(createSkillStep).toHaveTextContent('English (UK)');
    expect(createSkillStep).toHaveTextContent('en-GB');
    expect(createSkillStep).toHaveTextContent('Provision your own');
  });

  it('downloads interaction model with current form values', async () => {
    const user = userEvent.setup();
    render(
      <AlexaSetupChecklist
        invocationName="my plex"
        locale="en-CA"
      />,
    );

    await user.click(screen.getByRole('button', { name: /download interaction model/i }));
    expect(downloadInteractionModel).toHaveBeenCalledWith('my plex', 'en-CA');
  });

  it('shows the French skill locale and downloads that model', async () => {
    const user = userEvent.setup();
    render(
      <AlexaSetupChecklist
        invocationName="plexa"
        locale="fr-FR"
      />,
    );

    expect(screen.getByText('Create skill.').closest('li')).toHaveTextContent('Français (France)');
    await user.click(screen.getByRole('button', { name: /download interaction model/i }));
    expect(downloadInteractionModel).toHaveBeenCalledWith('plexa', 'fr-FR');
  });
});
