// Statistics for the benchmark: medians, bootstrap confidence intervals and
// the Mann-Whitney U test. See bench/README.md for how they are used.

import { rng } from './fixtures.mjs';

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Coefficient of variation (sample standard deviation / mean). */
export function cv(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return sd / mean;
}

function percentile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function resample(xs, random) {
  const out = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[Math.floor(random() * xs.length)];
  return out;
}

const BOOTSTRAP = 4000;

/** 95% percentile-bootstrap confidence interval of the median. */
export function medianCI(xs, seed = 1) {
  if (xs.length < 2) return [xs[0], xs[0]];
  const random = rng(seed);
  const medians = Array.from({ length: BOOTSTRAP }, () => median(resample(xs, random))).sort((a, b) => a - b);
  return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

/**
 * 95% percentile-bootstrap confidence interval of median(b) / median(a)
 * (both samples resampled independently).
 */
export function ratioCI(a, b, seed = 1) {
  const random = rng(seed);
  const ratios = Array.from(
    { length: BOOTSTRAP },
    () => median(resample(b, random)) / median(resample(a, random)),
  ).sort((x, y) => x - y);
  return [percentile(ratios, 0.025), percentile(ratios, 0.975)];
}

// Complementary error function (Numerical Recipes' erfcc, |error| < 1.2e-7).
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/**
 * Two-sided Mann-Whitney U test (normal approximation with tie correction and
 * continuity correction; adequate for the 15+ observations per group used
 * here). Returns { u, z, p }.
 */
export function mannWhitney(a, b) {
  const all = [...a.map(v => [v, 0]), ...b.map(v => [v, 1])].sort((x, y) => x[0] - y[0]);
  const n = all.length;
  const ranks = new Array(n);
  let tieTerm = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1][0] === all[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  let rankSumA = 0;
  for (let i = 0; i < n; i++) if (all[i][1] === 0) rankSumA += ranks[i];
  const n1 = a.length;
  const n2 = b.length;
  const u = rankSumA - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (sigma === 0) return { u, z: 0, p: 1 };
  const z = (Math.abs(u - mu) - 0.5) / sigma;
  return { u, z: Math.sign(u - mu) * Math.max(z, 0), p: Math.min(1, erfc(Math.max(z, 0) / Math.SQRT2)) };
}

/**
 * The smallest p-value mannWhitney can return for samples of these sizes
 * (when they do not overlap at all): e.g. 0.081 for 3 and 3, 0.012 for 5 and
 * 5, 0.0051 for 6 and 6.
 */
export function minMannWhitneyP(n1, n2) {
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1));
  return Math.min(1, erfc(((n1 * n2) / 2 - 0.5) / sigma / Math.SQRT2));
}

/**
 * Compares `b` (the newer implementation) with `a`. A change counts only when
 * it is statistically significant (Mann-Whitney p < alpha) and at least
 * `threshold` (relative, on the medians). When it is not significant but the
 * ratio's confidence interval still reaches past ±threshold, the data cannot
 * rule out a change of that size: the comparison is inconclusive (or, when
 * there are too few observations for any p-value below alpha, it says so).
 */
export function compare(a, b, { alpha = 0.01, threshold = 0.1, minor = 0.05 } = {}) {
  const change = median(b) / median(a) - 1;
  const [lo, hi] = ratioCI(a, b);
  const { p } = mannWhitney(a, b);
  let verdict;
  if (p >= alpha && minMannWhitneyP(a.length, b.length) >= alpha) verdict = 'too few observations';
  else if (p < alpha && Math.abs(change) >= threshold) verdict = change > 0 ? 'regression' : 'improvement';
  else if (p < alpha && Math.abs(change) >= minor) verdict = change > 0 ? 'minor slowdown' : 'minor speedup';
  else if (p < alpha) verdict = 'within 5%';
  else if (hi - 1 >= threshold || 1 - lo >= threshold) verdict = 'inconclusive';
  else verdict = 'no significant change';
  return { change, ci: [lo - 1, hi - 1], p, verdict };
}
