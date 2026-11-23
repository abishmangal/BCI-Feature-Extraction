import { createElement, type ReactNode } from 'react';
import type { FamilyId } from '../store/store';

const variable = (name: string) => createElement('mi', null, name);
const operator = (symbol: string) => createElement('mo', null, symbol);
const number = (value: number | string) => createElement('mn', null, value);
const row = (...terms: ReactNode[]) => createElement('mrow', null, ...terms);
const subscript = (base: ReactNode, index: ReactNode) => createElement('msub', null, base, index);
const square = (base: ReactNode) => createElement('msup', null, base, number(2));
const fraction = (top: ReactNode, bottom: ReactNode) => createElement('mfrac', null, top, bottom);
const parentheses = (...terms: ReactNode[]) => row(operator('('), ...terms, operator(')'));
const absolute = (...terms: ReactNode[]) => row(operator('|'), ...terms, operator('|'));
const sqrt = (term: ReactNode) => createElement('msqrt', null, term);
const indexed = (name: string, index: string) => subscript(variable(name), variable(index));
const sum = (index: ReactNode, ...terms: ReactNode[]) =>
  row(createElement('munder', null, operator('∑'), index), ...terms);
const sumOver = (index: string, ...terms: ReactNode[]) => sum(variable(index), ...terms);
const call = (name: string, ...args: ReactNode[]) =>
  row(createElement('mi', { mathvariant: 'normal' }, name), parentheses(...args));
const minus = operator('−');
const plus = operator('+');
const comma = operator(',');
const equal = (left: ReactNode, right: ReactNode) => row(left, operator('='), right);
const sciEps = createElement('msup', null, number(10), row(minus, number(12)));
const x = variable('x');
const t = variable('t');
const f = variable('f');
const k = variable('k');
const p = variable('P');
const z = variable('z');
const transpose = (term: ReactNode) => createElement('msup', null, term, variable('T'));
const derivative = (term: ReactNode) => createElement('msup', null, term, operator('′'));
const hat = (term: ReactNode) => createElement('mover', { accent: 'true' }, term, operator('^'));
const lineLength = equal(
  variable('Line length'),
  sum(row(t, operator('>'), number(1)), absolute(indexed('x', 't'), minus, subscript(x, row(t, minus, number(1))))),
);
const higuchi = equal(
  variable('Higuchi FD'),
  call('slope', call('log', fraction(number(1), k)), comma, call('log', call('L', k))),
);

const featureFormulas: Record<FamilyId, { equations: ReactNode[]; note?: string }> = {
  band_power: {
    equations: [equal(p, row(
      createElement('msubsup', null, operator('∫'), indexed('f', 'lo'), indexed('f', 'hi')),
      call('PSD', f), variable('d'), f,
    ))],
    note: 'Welch power spectral density integrated by the trapezoid rule. Power is in µV².',
  },
  csp: {
    equations: [
      equal(variable('w'), row(
        createElement('munder', null, operator('arg max'), variable('w')),
        fraction(row(transpose(variable('w')), indexed('C', 'a'), variable('w')),
          row(transpose(variable('w')), indexed('C', 'b'), variable('w'))),
      )),
      equal(variable('Feature'), call('log', call('var', transpose(variable('w')), x))),
    ],
    note: 'Spatial filters are fitted on training folds only.',
  },
  hjorth: {
    equations: [
      equal(call('Activity', x), call('var', x)),
      equal(call('Mobility', x), sqrt(fraction(call('var', derivative(x)), call('var', x)))),
      equal(call('Complexity', x), fraction(call('Mobility', derivative(x)), call('Mobility', x))),
    ],
  },
  wavelet: {
    equations: [equal(call('E', f), row(indexed('mean', 't'),
      parentheses(square(absolute(call('CWT', x, comma, f, comma, t))))))],
    note: 'Mean over the selected time window using the complex Morlet wavelet. Energy is in µV².',
  },
  covariance: {
    equations: [
      equal(variable('C'), call('cov', x)),
      equal(variable('s'), call('TangentSpace', variable('C'))),
    ],
    note: 'Covariance uses OAS or SCM. The tangent space is centred on the training-fold mean.',
  },
  time_stats: {
    equations: [
      equal(call('var', x), call('mean', square(parentheses(x, minus, call('mean', x))))),
      equal(variable('RMS'), sqrt(call('mean', square(x)))),
      lineLength,
      equal(indexed('κ', 'excess'), row(variable('κ'), minus, number(3))),
      higuchi,
    ],
    note: 'Variance uses ddof = 0. Excess kurtosis is zero for a Gaussian. Higuchi uses scales 1 through kmax.',
  },
  window_means: {
    equations: [
      equal(indexed('m', 'j'), row(fraction(number(1), indexed('n', 'j')),
        sum(row(t, operator('∈'), indexed('B', 'j')), indexed('x', 't')))),
      equal(indexed('x′', 't'), row(indexed('x', 't'), minus, call('mean', indexed('x', 'baseline')))),
    ],
    note: 'The first equation averages bin j. The second is the optional baseline correction.',
  },
  spectral_features: {
    equations: [
      equal(indexed('n', 'perseg'), call('min', call('round', indexed('f', 's')), comma, indexed('n', 'samples'))),
      equal(indexed('P', 'relative'), fraction(indexed('P', 'band'), indexed('P', 'reference'))),
      equal(variable('Entropy'), fraction(row(minus, sumOver('i', indexed('p', 'i'), call('log', indexed('p', 'i')))),
        call('log', indexed('n', 'pos')))),
      equal(variable('Centroid'), fraction(sumOver('i', indexed('f', 'i'), indexed('P', 'i')), sumOver('i', indexed('P', 'i')))),
      equal(variable('Peak frequency'), row(createElement('munder', null, operator('arg max'), f), call('P', f))),
      equal(variable('Ratio'), fraction(indexed('P', 'num'), row(indexed('P', 'den'), plus, sciEps))),
    ],
    note: 'Welch uses 50% overlap. Band power is integrated by the trapezoid rule. Peak search is within the reference band.',
  },
  tf_regions: {
    equations: [
      equal(call('P', f, comma, t), square(absolute(call('CWT', indexed('x', 'bandpassed'), comma, f, comma, t)))),
      equal(variable('% change'), row(number(100), fraction(
        row(indexed('P', 'task'), minus, indexed('P', 'baseline')), indexed('P', 'baseline'),
      ))),
    ],
    note: 'The transform uses the full band-passed epoch. The rectangle can report mean, maximum or energy.',
  },
  asymmetry: {
    equations: [
      equal(variable('Difference'), row(indexed('P', 'left'), minus, indexed('P', 'right'))),
      equal(variable('Normalized'), fraction(
        row(indexed('P', 'left'), minus, indexed('P', 'right')),
        row(indexed('P', 'left'), plus, indexed('P', 'right'), plus, sciEps),
      )),
    ],
  },
  complexity: {
    equations: [lineLength, higuchi],
    note: 'Higuchi uses scales 1 through kmax.',
  },
  autoencoder: {
    equations: [
      equal(variable('h'), call('tanh', indexed('W', '1'), z, plus, indexed('b', '1'))),
      equal(hat(x), row(indexed('W', '2'), variable('h'), plus, indexed('b', '2'))),
      equal(variable('Loss'), call('mean', square(parentheses(hat(x), minus, z)))),
    ],
    note: 'The input z is the standardized, decimated trial.',
  },
};

function Equation({ value }: { value: ReactNode }) {
  return createElement('math', { display: 'block' }, value);
}

export function FeatureEquations({ family }: { family: FamilyId }) {
  const { equations, note } = featureFormulas[family];
  return (
    <div className="equations">
      {equations.map((value, i) => <Equation key={i} value={value} />)}
      {note ? <p>{note}</p> : null}
    </div>
  );
}

export function SignedLogEquation() {
  return (
    <div className="equations">
      <Equation value={equal(call('signed log', x), row(call('sign', x), operator('·'),
        call('log', number(1), plus, absolute(x))))} />
    </div>
  );
}

export function FisherEquation() {
  return (
    <div className="equations" aria-label="Fisher score">
      <Equation value={equal(variable('F'), fraction(
        sumOver('k', indexed('n', 'k'), square(parentheses(indexed('μ', 'k'), minus, variable('μ')))),
        row(sumOver('k', indexed('n', 'k'), indexed('σ²', 'k')), plus, sciEps),
      ))} />
    </div>
  );
}
