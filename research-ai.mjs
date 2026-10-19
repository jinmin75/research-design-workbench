import {createGeminiApi} from './gemini-api.mjs';
import {createSubscriptionBridge} from './subscription-ai.mjs';
import {resolveProviderPaths} from './provider-login.mjs';

export async function createResearchAI({subscription, gemini} = {}) {
  const cli = subscription || createSubscriptionBridge({paths: await resolveProviderPaths()});
  const api = gemini || createGeminiApi();
  return {
    async status() {
      const state = await cli.status({excludeProviders: ['gemini']});
      const apiState = api.status();
      const providers = (state.providers || []).filter(provider => provider.id !== 'gemini');
      const claudeIndex = providers.findIndex(provider => provider.id === 'claude');
      providers.splice(claudeIndex < 0 ? providers.length : claudeIndex, 0, apiState);
      return {...state, mode: 'personal_connections', providers};
    },
    assist(provider, context, options) {
      return provider === 'gemini' ? api.assist(context, options) : cli.assist(provider, context, options);
    },
    configureGemini(settings) { return api.configure(settings); }
  };
}

let systemAI;
const getSystemAI = () => systemAI ??= createResearchAI();
export const researchAIStatus = async () => (await getSystemAI()).status();
export const assistResearchAI = async (provider, context, options) => (await getSystemAI()).assist(provider, context, options);
export const configureGeminiAPI = async settings => (await getSystemAI()).configureGemini(settings);
