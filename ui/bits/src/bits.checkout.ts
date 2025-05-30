import * as xhr from 'lib/xhr';
import { spinnerHtml } from 'lib/view/controls';
import { contactEmail } from './bits';
import { prompt } from 'lib/view/dialogs';
import { myUserId } from 'lib';

export interface Pricing {
  currency: string;
  default: number;
  min: number;
  max: number;
  lifetime: number;
  giftMin: number;
}

const $checkout = $('div.plan_checkout');
const getVal = (selector: string): string => {
  const values = $checkout.find(selector).val();
  return typeof values === 'string' ? values : values[0];
};
const getFreq = (): string => getVal('group.freq input:checked');
const getDest = (): string => getVal('group.dest input:checked');
const showErrorThenReload = (error: string) => {
  alert(error);
  location.assign('/patron');
};

export function initModule({
  stripePublicKey,
  pricing,
}: {
  stripePublicKey: string;
  pricing: Pricing;
}): void {
  contactEmail();

  const hasLifetime = $('#freq_lifetime').prop('disabled');

  const toggleInput = ($input: Cash, enable: boolean) =>
    $input.prop('disabled', !enable).toggleClass('disabled', !enable);

  // Other is selected but no amount specified
  // happens with backward button
  if (!$checkout.find('.amount_choice group.amount input:checked').data('amount'))
    $checkout.find('input.default').trigger('click');

  const onFreqChange = function () {
    const freq = getFreq();
    $checkout.find('.amount_fixed').toggleClass('none', freq !== 'lifetime');
    $checkout.find('.amount_choice').toggleClass('none', freq === 'lifetime');
    const sub = freq === 'monthly';
    $checkout.find('.paypal--order').toggle(!sub);
    $checkout.find('.paypal--subscription').toggle(sub);
  };
  onFreqChange();

  $checkout.find('group.freq input').on('change', onFreqChange);

  $checkout.find('group.dest input').on('change', () => {
    const isGift = getDest() === 'gift';
    const $monthly = $('#freq_monthly');
    toggleInput($monthly, !isGift);
    $checkout.find('.gift').toggleClass('none', !isGift).find('input').val('');
    const $lifetime = $('#freq_lifetime');
    toggleInput($lifetime, isGift || !hasLifetime);
    $lifetime.toggleClass('lifetime-check', !isGift && hasLifetime);
    if (isGift) {
      if ($monthly.is(':checked')) $('#freq_onetime').trigger('click');
      $checkout.find('.gift input').trigger('focus');
    }
    toggleCheckout();
  });

  $checkout.find('group.amount .other label').on('click', async function (this: HTMLLabelElement) {
    let amount: number;
    const raw: string = (await prompt(this.title)) ?? '';
    try {
      amount = parseFloat(raw.replace(',', '.').replace(/[^0-9\.]/gim, ''));
    } catch (_) {
      return false;
    }
    if (!amount) {
      $(this).text($(this).data('trans-other'));
      $checkout.find('input.default').trigger('click');
      return false;
    }
    const isGift = !!$checkout.find('.gift input').val();
    const min = isGift ? pricing.giftMin : pricing.min;
    amount = Math.max(min, Math.min(pricing.max, amount));
    $(this).text(`${pricing.currency} ${amount}`);
    ($(this).siblings('input').data('amount', amount)[0] as HTMLInputElement).checked = true;
  });

  const $userInput = $checkout.find('input.user-autocomplete');

  const getGiftDest = () => {
    const raw = ($userInput.val() as string).trim().toLowerCase();
    return raw !== myUserId() && raw.match(/^[a-z0-9][\w-]{2,29}$/) ? raw : null;
  };

  const toggleCheckout = () => {
    const giftDest = getGiftDest();
    const enabled = getDest() !== 'gift' || !!giftDest;
    toggleInput($checkout.find('.service button'), enabled);
    $checkout.find('.service .paypal--disabled').toggleClass('none', enabled);
    $checkout.find('.service .paypal:not(.paypal--disabled)').toggleClass('none', !enabled);
  };

  $userInput.on('change', toggleCheckout).on('input', toggleCheckout);

  const getAmountToCharge = () => {
    const freq = getFreq(),
      amount =
        freq === 'lifetime'
          ? pricing.lifetime
          : parseFloat($checkout.find('group.amount input:checked').data('amount'));
    const isGift = !!$checkout.find('.gift input').val();
    const min = isGift ? pricing.giftMin : pricing.min;
    if (amount < min && isGift) {
      alert(`Minimum gift amount is ${pricing.currency} ${pricing.giftMin}`);
      return undefined;
    } else if (amount < min && !isGift) {
      alert(`Minimum amount is ${pricing.currency} ${pricing.giftMin}`);
      return undefined;
    } else if (amount > pricing.max) {
      alert(`Maximum amount is ${pricing.currency} ${pricing.max}`);
      return undefined;
    }
    return amount;
  };

  const $currencyForm = $('form.currency');
  $('.currency-toggle').one('click', () => $currencyForm.toggleClass('none'));
  $currencyForm.find('select').on('change', () => {
    ['freq', 'dest'].forEach(name =>
      $('<input type="hidden">')
        .attr('name', name)
        .val($(`input[name=${name}]:checked`).val())
        .appendTo($currencyForm),
    );
    ($currencyForm[0] as HTMLFormElement).submit();
  });

  const queryParams = new URLSearchParams(location.search);
  for (const name of ['dest', 'freq']) {
    if (queryParams.has(name))
      $(`input[name=${name}][value=${queryParams.get(name)?.replace(/[^a-z_-]/gi, '')}]`).trigger('click');
  }
  for (const name of ['giftUsername']) {
    if (queryParams.has(name))
      $(`input[name=${name}]`).val(queryParams.get(name)!.replace(/[^a-z0-9_-]/gi, ''));
  }

  toggleCheckout();

  payPalOrderStart($checkout, pricing, getAmountToCharge);
  payPalSubscriptionStart($checkout, pricing, getAmountToCharge);
  stripeStart($checkout, stripePublicKey, pricing, getAmountToCharge);
}

const xhrFormData = ($checkout: Cash, amount: number) =>
  xhr.form({
    email: $checkout.data('email'),
    amount,
    freq: getFreq(),
    gift: $checkout.find('.gift input').val(),
  });

const payPalStyle = {
  layout: 'horizontal',
  color: 'blue',
  height: 55,
};

function payPalOrderStart($checkout: Cash, pricing: Pricing, getAmount: () => number | undefined) {
  if (!window.paypalOrder) return;
  (window.paypalOrder as any)
    .Buttons({
      style: payPalStyle,
      createOrder: (_data: any, _actions: any) => {
        const amount = getAmount();
        if (!amount) return;
        return xhr
          .jsonAnyResponse(`/patron/paypal/checkout?currency=${pricing.currency}`, {
            method: 'post',
            body: xhrFormData($checkout, amount),
          })
          .then(res => res.json())
          .then(data => {
            if (data.error) showErrorThenReload(data.error);
            else if (data.order?.id) return data.order.id;
            else location.assign('/patron');
          });
      },
      onApprove: (data: any, _actions: any) => {
        xhr
          .json('/patron/paypal/capture/' + data.orderID, { method: 'POST' })
          .then(() => location.assign('/patron/thanks'));
      },
    })
    .render('.paypal--order');
}

function payPalSubscriptionStart($checkout: Cash, pricing: Pricing, getAmount: () => number | undefined) {
  if (!window.paypalSubscription) return;
  (window.paypalSubscription as any)
    .Buttons({
      style: payPalStyle,
      createSubscription: (_data: any, _actions: any) => {
        const amount = getAmount();
        if (!amount) return;
        return xhr
          .jsonAnyResponse(`/patron/paypal/checkout?currency=${pricing.currency}`, {
            method: 'post',
            body: xhrFormData($checkout, amount),
          })
          .then(res => res.json())
          .then(data => {
            if (data.error) showErrorThenReload(data.error);
            else if (data.subscription?.id) return data.subscription.id;
            else location.assign('/patron');
          });
      },
      onApprove: (data: any, _actions: any) => {
        xhr
          .json(`/patron/paypal/capture/${data.orderID}?sub=${data.subscriptionID}`, { method: 'POST' })
          .then(() => location.assign('/patron/thanks'));
      },
    })
    .render('.paypal--subscription');
}

function stripeStart(
  $checkout: Cash,
  publicKey: string,
  pricing: Pricing,
  getAmount: () => number | undefined,
) {
  const stripe = window.Stripe(publicKey);
  $checkout.find('.service .stripe').on('click', function () {
    const amount = getAmount();
    if (!amount) return;
    $checkout.find('.service').html(spinnerHtml);

    xhr
      .jsonAnyResponse(`/patron/stripe/checkout?currency=${pricing.currency}`, {
        method: 'post',
        body: xhrFormData($checkout, amount),
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) showErrorThenReload(data.error);
        else if (data.session?.id) {
          stripe
            .redirectToCheckout({
              sessionId: data.session.id,
            })
            .then((result: any) => showErrorThenReload(result.error.message));
        } else location.assign('/patron');
      });
  });

  // Close Checkout on page navigation:
  $(window).on('popstate', function () {
    window.stripeHandler.close();
  });
}
