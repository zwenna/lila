import { type Redraw, type VNode, bind, dataIcon, looseH as h, onInsert } from 'lib/snabbdom';
import { json as xhrJson } from 'lib/xhr';
import * as licon from 'lib/licon';
import { spinnerVdom as spinner } from 'lib/view/controls';
import type { RelayTour, RoundId, TourId } from './interfaces';
import { playerFed } from '../playerBars';
import { userTitle } from 'lib/view/userLink';
import type {
  ChapterId,
  Federations,
  FideId,
  PointsStr,
  StudyPlayer,
  StudyPlayerFromServer,
} from '../interfaces';
import { sortTable, extendTablesortNumber } from 'lib/tablesort';
import { defined } from 'lib';
import { type Attrs, type Hooks, init as initSnabbdom, attributesModule, type VNodeData } from 'snabbdom';
import { convertPlayerFromServer } from '../studyChapters';
import { isTouchDevice } from 'lib/device';

export type RelayPlayerId = FideId | string;

interface RelayPlayer extends StudyPlayer {
  score?: number;
  played?: number;
  ratingDiff?: number;
  performance?: number;
}

interface RelayPlayerGame {
  id: ChapterId;
  round: RoundId;
  opponent: RelayPlayer;
  color: Color;
  points?: PointsStr;
  ratingDiff?: number;
}

interface RelayPlayerWithGames extends RelayPlayer {
  games: RelayPlayerGame[];
  fide?: FidePlayer;
}

interface FidePlayer {
  ratings: {
    [key: string]: number;
  };
  year?: number;
}

interface PlayerToShow {
  id?: RelayPlayerId;
  player?: RelayPlayerWithGames;
}

const playerId = (p: StudyPlayer) => p.fideId || p.name;

export default class RelayPlayers {
  loading = false;
  players?: RelayPlayer[];
  show?: PlayerToShow;

  constructor(
    private readonly tourId: TourId,
    readonly switchToPlayerTab: () => void,
    readonly isEmbed: boolean,
    private readonly federations: () => Federations | undefined,
    private readonly redraw: Redraw,
  ) {
    const locationPlayer = location.hash.startsWith('#players/') && location.hash.slice(9);
    if (locationPlayer) this.showPlayer(locationPlayer);
  }

  tabHash = () => (this.show ? `#players/${this.show.id}` : '#players');

  switchTabAndShowPlayer = async (id: RelayPlayerId) => {
    this.switchToPlayerTab();
    this.showPlayer(id);
    this.redraw();
  };

  showPlayer = async (id: RelayPlayerId) => {
    this.show = { id };
    const player = await this.loadPlayerWithGames(id);
    this.show = { id, player };
    this.redraw();
  };

  closePlayer = () => {
    this.show = undefined;
  };

  loadFromXhr = async (onInsert?: boolean) => {
    if (this.players && !onInsert) {
      this.loading = true;
      this.redraw();
    }
    const players: (RelayPlayer & StudyPlayerFromServer)[] = await xhrJson(
      `/broadcast/${this.tourId}/players`,
    );
    this.players = players.map(p => convertPlayerFromServer(p, this.federations()));
    this.redraw();
  };

  loadPlayerWithGames = async (id: RelayPlayerId) => {
    const feds = this.federations();
    const full: RelayPlayerWithGames = await xhrJson(
      `/broadcast/${this.tourId}/players/${encodeURIComponent(id)}`,
    ).then(p => convertPlayerFromServer(p, feds));
    full.games.forEach((g: RelayPlayerGame) => {
      g.opponent = convertPlayerFromServer(g.opponent as RelayPlayer & StudyPlayerFromServer, feds);
    });
    return full;
  };

  playerLinkConfig = (p: StudyPlayer): VNodeData | undefined => playerLinkConfig(this, p, true);
}

export const playersView = (ctrl: RelayPlayers, tour: RelayTour): VNode =>
  ctrl.show ? playerView(ctrl, ctrl.show, tour) : playersList(ctrl);

const ratingCategs = [
  ['standard', i18n.site.classical],
  ['rapid', i18n.site.rapid],
  ['blitz', i18n.site.blitz],
];

const playerView = (ctrl: RelayPlayers, show: PlayerToShow, tour: RelayTour): VNode => {
  const p = show.player;
  const year = (tour.dates?.[0] ? new Date(tour.dates[0]) : new Date()).getFullYear();
  const tc = tour.info.fideTc || 'standard';
  const age: number | undefined = p?.fide?.year && year - p.fide.year;
  const fidePageData = p && { attrs: fidePageLinkAttrs(p, ctrl.isEmbed) };
  return h(
    'div.relay-tour__player',
    {
      class: { loading: !show.player },
    },
    p
      ? [
          h(`a.relay-tour__player__name`, fidePageData, [userTitle(p), p.name]),
          p.team
            ? h('div.relay-tour__player__team.text', { attrs: dataIcon(licon.Group) }, p.team)
            : undefined,
          h('div.relay-tour__player__cards', [
            ...(p.fide?.ratings
              ? ratingCategs.map(([key, name]) =>
                  h(`div.relay-tour__player__card${key === tc ? '.active' : ''}`, [
                    h('em', name),
                    h('span', [p.fide?.ratings[key] || '-']),
                  ]),
                )
              : []),
            age
              ? h('div.relay-tour__player__card', [h('em', i18n.broadcast.ageThisYear), h('span', [age])])
              : undefined,
            p.fed
              ? h('div.relay-tour__player__card', [
                  h('em', i18n.broadcast.federation),
                  h('a.relay-tour__player__fed', { attrs: { href: `/fide/federation/${p.fed.name}` } }, [
                    h('img.mini-game__flag', {
                      attrs: { src: site.asset.url(`images/fide-fed-webp/${p.fed.id}.webp`) },
                    }),
                    p.fed.name,
                  ]),
                ])
              : undefined,
            p.fideId
              ? h('div.relay-tour__player__card', [
                  h('em', 'FIDE ID'),
                  h('a', fidePageData, p.fideId.toString()),
                ])
              : undefined,
            p.score
              ? h('div.relay-tour__player__card', [
                  h('em', i18n.broadcast.score),
                  h('span', [p.score, ' / ', p.played]),
                ])
              : undefined,
            p.performance
              ? h('div.relay-tour__player__card', [
                  h('em', i18n.site.performance),
                  h('span', [p.performance, p.games.length < 4 ? '?' : '']),
                ])
              : undefined,
            p.ratingDiff &&
              h('div.relay-tour__player__card', [h('em', i18n.broadcast.ratingDiff), ratingDiff(p)]),
          ]),
          h('table.relay-tour__player__games.slist.slist-pad', [
            h('thead', h('tr', h('td', { attrs: { colspan: 69 } }, i18n.broadcast.gamesThisTournament))),
            renderPlayerGames(ctrl, p, true),
          ]),
        ]
      : [spinner()],
  );
};

const playersList = (ctrl: RelayPlayers): VNode =>
  h(
    'div.relay-tour__players',
    {
      class: { loading: ctrl.loading, nodata: !ctrl.players },
      hook: {
        insert: () => ctrl.loadFromXhr(true),
      },
    },
    ctrl.players ? renderPlayers(ctrl, ctrl.players) : [spinner()],
  );

const renderPlayers = (ctrl: RelayPlayers, players: RelayPlayer[]): VNode => {
  const withRating = !!players.find(p => p.rating);
  const withScores = !!players.find(p => p.score);
  const defaultSort = { attrs: { 'data-sort-default': 1 } };
  const sortByBoth = (x?: number, y?: number) => ({
    attrs: { 'data-sort': (x || 0) * 100000 + (y || 0) },
  });
  return h(
    'table.relay-tour__players.slist.slist-invert.slist-pad',
    {
      hook: onInsert(tableAugment),
    },
    [
      h(
        'thead',
        h('tr', [
          h('th', i18n.site.player),
          withRating ? h('th', !withScores && defaultSort, 'Elo') : undefined,
          withScores ? h('th', defaultSort, i18n.broadcast.score) : h('th', i18n.site.games),
        ]),
      ),
      h(
        'tbody',
        players.map(player =>
          h('tr', [
            h(
              'td.player-name',
              { attrs: { 'data-sort': player.name || '' } },
              h('a', playerLinkConfig(ctrl, player, true), [
                playerFed(player.fed),
                userTitle(player),
                player.name,
              ]),
            ),
            withRating
              ? h(
                  'td',
                  sortByBoth(player.rating, (player.score || 0) * 10),
                  player.rating ? [`${player.rating}`, ratingDiff(player)] : undefined,
                )
              : undefined,
            withScores
              ? h(
                  'td',
                  sortByBoth((player.score || 0) * 10, player.rating),
                  `${player.score}/${player.played}`,
                )
              : h('td', sortByBoth(player.played, player.rating), `${player.played}`),
          ]),
        ),
      ),
    ],
  );
};

const playerTipId = 'tour-player-tip';
export const playerLinkHook = (ctrl: RelayPlayers, player: RelayPlayer, withTip: boolean): Hooks => {
  const id = playerId(player);
  withTip = withTip && !isTouchDevice();
  return id
    ? {
        ...onInsert(el => {
          el.addEventListener('click', e => {
            e.preventDefault();
            ctrl.switchTabAndShowPlayer(id);
          });
          if (withTip)
            $(el).powerTip({
              closeDelay: 200,
              popupId: playerTipId,
              preRender() {
                const tipEl = document.getElementById(playerTipId) as HTMLElement;
                const patch = initSnabbdom([attributesModule]);
                tipEl.style.display = 'none';
                ctrl.loadPlayerWithGames(id).then((p: RelayPlayerWithGames) => {
                  const vdom = renderPlayerTipWithGames(ctrl, p);
                  tipEl.innerHTML = '';
                  patch(tipEl, h(`div#${playerTipId}`, vdom));
                  $.powerTip.reposition(el);
                });
              },
            });
        }),
        ...(withTip ? { destroy: vnode => $.powerTip.destroy(vnode.elm as HTMLElement) } : {}),
      }
    : {};
};

export const playerLinkConfig = (ctrl: RelayPlayers, player: StudyPlayer, withTip: boolean): VNodeData => {
  const id = playerId(player);
  return id
    ? {
        attrs: {
          href: `#players/${playerId(player)}`,
        },
        hook: playerLinkHook(ctrl, player, withTip),
      }
    : {};
};

export const fidePageLinkAttrs = (p: StudyPlayer, blank?: boolean): Attrs | undefined =>
  p.fideId ? { href: `/fide/${p.fideId}/redirect`, ...(blank ? { target: '_blank' } : {}) } : undefined;

const isRelayPlayer = (p: StudyPlayer | RelayPlayer): p is RelayPlayer => 'score' in p;

const renderPlayerTipHead = (ctrl: RelayPlayers, p: StudyPlayer | RelayPlayer): VNode =>
  h('div.tpp__player', [
    h(`a.tpp__player__name`, playerLinkConfig(ctrl, p, false), [userTitle(p), p.name]),
    p.team ? h('div.tpp__player__team', p.team) : undefined,
    h('div.tpp__player__info', [
      h('div', [
        playerFed(p.fed),
        ...(p.rating ? [`${p.rating}`, isRelayPlayer(p) ? ratingDiff(p) : undefined] : []),
      ]),
      isRelayPlayer(p) && p.score !== undefined ? h('div', `${p.score}/${p.played}`) : undefined,
    ]),
  ]);

const renderPlayerTipWithGames = (ctrl: RelayPlayers, p: RelayPlayerWithGames): VNode =>
  h('div.tpp', [
    renderPlayerTipHead(ctrl, p),
    h('div.tpp__games', h('table', renderPlayerGames(ctrl, p, false))),
  ]);

const renderPlayerGames = (ctrl: RelayPlayers, p: RelayPlayerWithGames, withTips: boolean): VNode =>
  h(
    'tbody',
    p.games.map((game, i) => {
      const op = game.opponent;
      const points = game.points;
      return h(
        'tr',
        {
          hook: bind('click', e => {
            let tr = e.target as HTMLLinkElement;
            while (tr && tr.tagName !== 'TR') tr = tr.parentNode as HTMLLinkElement;
            const href = tr.querySelector('a')?.href;
            if (href) location.href = href;
          }),
        },
        [
          h('td', `${i + 1}`),
          h(
            'td',
            h(
              'a',
              {
                hook: withTips ? playerLinkHook(ctrl, op, true) : {},
                attrs: { href: `/broadcast/-/-/${game.round}/${game.id}` },
              },
              [playerFed(op.fed), userTitle(op), op.name],
            ),
          ),
          h('td', op.rating?.toString()),
          h('td.is.color-icon.' + game.color),
          h(
            'td.tpp__games__status',
            points
              ? points === '1'
                ? h('good', '1')
                : points === '0'
                  ? h('bad', '0')
                  : h('span', '½')
              : '*',
          ),
          h('td', defined(game.ratingDiff) ? ratingDiff(game) : undefined),
        ],
      );
    }),
  );

const ratingDiff = (p: RelayPlayer | RelayPlayerGame) => {
  const rd = p.ratingDiff;
  return !defined(rd)
    ? undefined
    : rd > 0
      ? h('good.rp', '+' + rd)
      : rd < 0
        ? h('bad.rp', '−' + -rd)
        : h('span.rp--same', ' ==');
};

const tableAugment = (el: HTMLTableElement) => {
  extendTablesortNumber();
  $(el).each(function (this: HTMLElement) {
    sortTable(this, {
      descending: true,
    });
  });
};
