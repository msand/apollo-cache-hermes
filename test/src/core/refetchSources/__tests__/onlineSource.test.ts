import { onlineSource } from '@apollo/client';

it('onlineSource emits when the online event fires', () => {
  const next = jest.fn();

  const subscription = onlineSource().subscribe(next);

  window.dispatchEvent(new Event('online'));

  expect(next).toHaveBeenCalledTimes(1);

  subscription.unsubscribe();
});

it('onlineSource unsubscribe stops further online events from emitting', () => {
  const next = jest.fn();

  const subscription = onlineSource().subscribe(next);

  subscription.unsubscribe();

  window.dispatchEvent(new Event('online'));

  expect(next).not.toHaveBeenCalled();
});
