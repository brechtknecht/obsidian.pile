import React, { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import styles from './AISettingTabs.module.scss';
import { useAIContext } from 'renderer/context/AIContext';
import {
  usePilesContext,
  availableThemes,
} from 'renderer/context/PilesContext';
import { CardIcon, OllamaIcon, BoxOpenIcon, AIIcon } from 'renderer/icons';
import { useIndexContext } from 'renderer/context/IndexContext';

export default function AISettingTabs({ APIkey, setCurrentKey }) {
  const {
    prompt,
    setPrompt,
    updateSettings,
    setBaseUrl,
    getKey,
    setKey,
    deleteKey,
    model,
    setModel,
    embeddingModel,
    setEmbeddingModel,
    ollama,
    baseUrl,
    pileAIProvider,
    setPileAIProvider,
    harnessType,
    setHarnessType,
    harnessModel,
    setHarnessModel,
  } = useAIContext();

  const { currentTheme, setTheme } = usePilesContext();
  const [harnessStatus, setHarnessStatus] = useState(null);

  useEffect(() => {
    window.electron.ipc
      .invoke('harness-status')
      .then(setHarnessStatus)
      .catch(() => setHarnessStatus(null));
  }, []);

  const describeHarness = (key, label) => {
    if (!harnessStatus) return label;
    const status = harnessStatus[key];
    if (status?.broken) return `${label} — broken install`;
    return status?.available ? `${label} — installed` : `${label} — not found`;
  };

  const selectedHarnessStatus = harnessStatus?.[harnessType];

  const handleTabChange = (newValue) => {
    setPileAIProvider(newValue);
  };

  const handleInputChange = (setter) => (e) => setter(e.target.value);

  const renderThemes = () => {
    return Object.entries(availableThemes).map(([theme, colors]) => (
      <button
        key={`theme-${theme}`}
        className={`${styles.theme} ${
          currentTheme === theme ? styles.current : ''
        }`}
        onClick={() => setTheme(theme)}
      >
        <div
          className={styles.color1}
          style={{ background: colors.primary }}
        ></div>
      </button>
    ));
  };

  return (
    <Tabs.Root
      className={styles.tabsRoot}
      defaultValue="openai"
      value={pileAIProvider}
      onValueChange={handleTabChange}
    >
      <Tabs.List className={styles.tabsList} aria-label="Manage your account">
        <Tabs.Trigger className={styles.tabsTrigger} value="subscription">
          Subscription
          <CardIcon className={styles.icon} />
        </Tabs.Trigger>
        <Tabs.Trigger className={styles.tabsTrigger} value="ollama">
          Ollama API
          <OllamaIcon className={styles.icon} />
        </Tabs.Trigger>
        <Tabs.Trigger className={styles.tabsTrigger} value="openai">
          OpenAI API
          <BoxOpenIcon className={styles.icon} />
        </Tabs.Trigger>
        <Tabs.Trigger className={styles.tabsTrigger} value="harness">
          CLI Agent
          <AIIcon className={styles.icon} />
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content className={styles.tabsContent} value="subscription">
        <div className={styles.providers}>
          <div className={styles.pitch}>
            One simple subscription to use best-in-class AI with Pile, and
            support the project.
          </div>
          <div>
            <div className={styles.pro}>
              <div className={styles.left}>
                <div className={styles.price}>$9/month</div>
              </div>
              <div className={styles.right}>
                <div className={styles.subscribe}>Coming soon!</div>
              </div>
            </div>
            <div className={styles.disclaimer}>
              AI subscription for Pile is provided separately by{' '}
              <a href="https://un.ms" target="_blank">
                UNMS
              </a>
              . Subject to availability and capacity limits. Fair-use policy
              applies.
            </div>
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content className={styles.tabsContent} value="ollama">
        <div className={styles.providers}>
          <div className={styles.pitch}>
            Setup Ollama and set your preferred models here to use your local AI
            in Pile.
          </div>

          <div className={styles.group}>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="ollama-model">
                Model
              </label>
              <input
                id="ollama-model"
                className={styles.input}
                onChange={handleInputChange(setModel)}
                value={model}
                defaultValue="llama3.3"
                placeholder="llama3.3"
              />
            </fieldset>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="ollama-embedding-model">
                Embedding model
              </label>
              <input
                id="ollama-embedding-model"
                className={styles.input}
                onChange={handleInputChange(setEmbeddingModel)}
                value={embeddingModel}
                defaultValue="mxbai-embed-large"
                placeholder="mxbai-embed-large"
                disabled
              />
            </fieldset>
          </div>

          <div className={styles.disclaimer}>
            Ollama is the easiest way to run AI models on your own computer.
            Remember to pull your models in Ollama before using them in Pile.
            Learn more and download Ollama from{' '}
            <a href="https://ollama.com" target="_blank">
              ollama.com
            </a>
            .
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content className={styles.tabsContent} value="openai">
        <div className={styles.providers}>
          <div className={styles.pitch}>
            Create an API key in your OpenAI account and paste it here to start
            using GPT AI models in Pile.
          </div>

          <div className={styles.group}>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="openai-base-url">
                Base URL
              </label>
              <input
                id="openai-base-url"
                className={styles.input}
                onChange={handleInputChange(setBaseUrl)}
                value={baseUrl}
                placeholder="https://api.openai.com/v1"
              />
            </fieldset>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="openai-model">
                Model
              </label>
              <input
                id="openai-model"
                className={styles.input}
                onChange={handleInputChange(setModel)}
                value={model}
                placeholder="gpt-5.1"
              />
            </fieldset>
          </div>
          <fieldset className={styles.fieldset}>
            <label className={styles.label} htmlFor="openai-api-key">
              OpenAI API key
            </label>
            <input
              id="openai-api-key"
              className={styles.input}
              onChange={handleInputChange(setCurrentKey)}
              value={APIkey}
              placeholder="Paste an OpenAI API key to enable AI reflections"
            />
          </fieldset>
          <div className={styles.disclaimer}>
            Remember to manage your spend by setting up a budget in the API
            service you choose to use.
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content className={styles.tabsContent} value="harness">
        <div className={styles.providers}>
          <div className={styles.pitch}>
            Use an AI coding agent already installed on your computer.
            Reflections and chat run through its CLI on your existing
            subscription — no API key needed.
          </div>

          <div className={styles.group}>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="harness-type">
                Agent
              </label>
              <select
                id="harness-type"
                className={styles.input}
                onChange={handleInputChange(setHarnessType)}
                value={harnessType}
              >
                <option value="claude">
                  {describeHarness('claude', 'Claude Code')}
                </option>
                <option value="codex">
                  {describeHarness('codex', 'Codex')}
                </option>
              </select>
            </fieldset>
            <fieldset className={styles.fieldset}>
              <label className={styles.label} htmlFor="harness-model">
                Model (optional)
              </label>
              <input
                id="harness-model"
                className={styles.input}
                onChange={handleInputChange(setHarnessModel)}
                value={harnessModel}
                placeholder="CLI default (e.g. sonnet, opus)"
              />
            </fieldset>
          </div>

          <div className={styles.disclaimer}>
            {selectedHarnessStatus?.broken ? (
              <>
                This CLI is installed but its binary fails to run — reinstall
                it, then reopen settings.{' '}
              </>
            ) : selectedHarnessStatus?.available === false ? (
              <>
                The selected CLI was not found on this computer. Install it and
                sign in from a terminal first, then reopen settings.{' '}
              </>
            ) : selectedHarnessStatus?.version ? (
              <>Detected: {selectedHarnessStatus.version}. </>
            ) : null}
            Search and reflection context still use embeddings, which CLI
            agents cannot generate — your OpenAI key is used for those if
            set, otherwise local Ollama.
          </div>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}
