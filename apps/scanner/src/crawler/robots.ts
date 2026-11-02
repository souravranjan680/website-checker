/**
 * Minimal robots.txt support: reads the rules for "User-agent: *" and decides
 * whether a path may be crawled. The longest matching rule wins, and "Allow" wins ties
 * (the same logic Google documents). Wildcards "*" and the end anchor "$" are supported.
 */
export interface RobotsRules {
  allows(path: string): boolean;
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export const ALLOW_ALL: RobotsRules = { allows: () => true };

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: Rule[] = [];
  let groupApplies = false;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line.includes(':')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey!.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      // Consecutive User-agent lines form one group.
      const applies = value === '*';
      groupApplies = lastWasAgent ? groupApplies || applies : applies;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!groupApplies || (key !== 'allow' && key !== 'disallow')) continue;
    if (key === 'disallow' && value === '') continue; // "Disallow:" = allow everything
    const regex = new RegExp(
      `^${value
        .split('*')
        .map((part) => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&'))
        .join('.*')
        .replace(/\\\$$|\$$/, '$')}`,
    );
    rules.push({ allow: key === 'allow', pattern: value, regex });
  }

  return {
    allows(path) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}
