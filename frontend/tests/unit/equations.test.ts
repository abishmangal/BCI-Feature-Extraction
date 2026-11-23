import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FAMILY_IDS } from '../../src/engine/registry';
import { FeatureEquations, FisherEquation } from '../../src/ui/Equations';

it('renders feature formulas using native MathML', () => {
  for (const family of FAMILY_IDS) {
    expect(renderToStaticMarkup(createElement(FeatureEquations, { family }))).toContain('<math display="block">');
  }
  const hjorth = renderToStaticMarkup(createElement(FeatureEquations, { family: 'hjorth' }));
  expect(hjorth).toContain('<msqrt><mfrac>');
  const fisher = renderToStaticMarkup(createElement(FisherEquation));
  expect(fisher).toContain('<mfrac>');
  expect(fisher).toContain('<munder><mo>∑</mo>');
});
