import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings } from './types';

const PROVIDER_MODELS = {
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '1M token context' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Optimized for speed' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation' },
  ],
};

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    provider: 'google',
    apiKey: '',
    model: 'gemini-2.5-pro',
    toolMode: 'tool-router',
    composioApiKey: '',
  });
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showComposioKey, setShowComposioKey] = useState(false);

  useEffect(() => {
    // Load settings from chrome.storage
    chrome.storage.local.get(['atlasSettings'], (result) => {
      if (result.atlasSettings) {
        setSettings(result.atlasSettings);
      }
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ atlasSettings: settings }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // Send message to sidebar to refresh
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Configure your AI provider and preferences</p>
      </div>

      <div className="settings-content">
        <div className="setting-group">
          <label>AI Provider</label>
          <select
            value={settings.provider}
            onChange={(e) => {
              const newProvider = e.target.value as Settings['provider'];
              setSettings({
                ...settings,
                provider: newProvider,
                model: PROVIDER_MODELS[newProvider][0].id
              });
            }}
            className="model-select"
          >
            <option value="google">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div className="setting-group">
          <label>Model</label>
          <select
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            className="model-select"
          >
            {PROVIDER_MODELS[settings.provider].map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.description}
              </option>
            ))}
            <option value="custom">Custom Model</option>
          </select>
        </div>

        {settings.model === 'custom' && (
          <div className="setting-group">
            <label>Custom Model Name</label>
            <input
              type="text"
              value={settings.customModelName || ''}
              onChange={(e) => setSettings({ ...settings, customModelName: e.target.value })}
              placeholder="e.g., claude-sonnet-4-5-20250929"
              className="api-key-input"
            />
            <p className="help-text">
              Enter the exact model name/ID for your custom provider endpoint.
            </p>
          </div>
        )}

        <div className="setting-group">
          <label>Composio API Key</label>
          <div className="api-key-input-wrapper">
            <input
              type={showComposioKey ? 'text' : 'password'}
              value={settings.composioApiKey || ''}
              onChange={(e) => setSettings({ ...settings, composioApiKey: e.target.value })}
              placeholder="Enter your Composio API key (optional)"
              className="api-key-input"
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowComposioKey(!showComposioKey)}
            >
              {showComposioKey ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
          <p className="help-text">
            Enable Composio Tool Router for access to 500+ app integrations. Get your key from{' '}
            <a href="https://app.composio.dev/settings" target="_blank" rel="noopener noreferrer">
              Composio Dashboard
            </a>
          </p>
        </div>

        <div className="setting-group">
          <label>Custom Base URL (Optional)</label>
          <input
            type="text"
            value={settings.customBaseUrl || ''}
            onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
            placeholder="e.g., https://your-custom-endpoint.com"
            className="api-key-input"
          />
          <p className="help-text">
            Leave empty to use default Google AI endpoint. Enter a custom Gemini-compatible API endpoint to use your own provider.
          </p>
        </div>

        <div className="setting-group">
          <label>
            {settings.provider === 'google' && 'Google API Key'}
            {settings.provider === 'anthropic' && 'Anthropic API Key'}
            {settings.provider === 'openai' && 'OpenAI API Key'}
          </label>
          <div className="api-key-input-wrapper">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder={
                settings.provider === 'google' ? 'Enter your Google API key' :
                settings.provider === 'anthropic' ? 'Enter your Anthropic API key' :
                'Enter your OpenAI API key'
              }
              className="api-key-input"
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
          <p className="help-text">
            Get your API key from:{' '}
            {settings.provider === 'google' && (
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
                Google AI Studio
              </a>
            )}
            {settings.provider === 'anthropic' && (
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                Anthropic Console
              </a>
            )}
            {settings.provider === 'openai' && (
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                OpenAI Platform
              </a>
            )}
          </p>
        </div>

        <button
          className={`save-button ${saved ? 'saved' : ''}`}
          onClick={handleSave}
          disabled={!settings.apiKey}
        >
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>

        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-icon">◉</div>
            <h3>Browser Tools</h3>
            <p>Click the Browser Tools button (◉) to enable Gemini 2.5 Computer Use for direct browser automation with screenshots</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔧</div>
            <h3>Tool Router</h3>
            <p>Add Composio API key to access 500+ integrations (Gmail, Slack, GitHub, etc.) via AI SDK</p>
          </div>
        </div>

        <div className="info-box">
          <h3>🔒 Privacy & Security</h3>
          <p>Your API keys are stored locally in your browser and only sent to the respective AI providers. Never shared with third parties.</p>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<SettingsPage />);
