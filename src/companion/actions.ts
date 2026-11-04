export type CharacterAction='idle'|'walk'|'pat'|'drag'|'think'|'sleep'|'look'|'stretch'|'yawn'|'wave'|'shy'|'laugh'|'bow';
export type Motion={id:number;action:CharacterAction};
export const touchActions=['pat','wave','shy','laugh','bow','yawn'] as const;
export const autonomousActions=['walk','look','stretch','sleep'] as const;
export function chooseAction<T extends string>(actions:readonly T[],recent:T[],random=Math.random):T{
  const choices=actions.filter(action=>!recent.slice(-2).includes(action));
  const candidates=choices.length?choices:actions;
  return candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))];
}
export function activityDelay(random=Math.random){return 8000+Math.floor(random()*7001);}
