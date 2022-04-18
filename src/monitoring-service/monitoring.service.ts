import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DialectConnection } from './dialect-connection';
import {
  ProgramAccount,
  Proposal,
  Realm,
} from '@solana/spl-governance';
import {
  TwitterNotification,
  TwitterNotificationsSink,
} from './twitter-notifications-sink';

import {
  Monitors,
  NotificationSink,
  Pipelines,
  SourceData,
} from '@dialectlabs/monitor';
import { Duration } from 'luxon';
import {
  SolanaProvider,
} from "@saberhq/solana-contrib";
import {
  TribecaSDK,
  GovernorWrapper,
  GovernorData,
} from '@tribecahq/tribeca-sdk';
import { Provider } from '@project-serum/anchor';
import { Wallet_ } from '@dialectlabs/web3';
require('isomorphic-fetch');

const mainnetPK = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');
const sbrGovernorAddress = new PublicKey('9tnpMysuibKx6SatcH3CWR9ZsSRMBNeBf1mhfL6gAXR4');

const connection = new Connection(
  process.env.REALMS_PRC_URL ?? process.env.RPC_URL!,
);

interface RealmData {
  realm: ProgramAccount<Realm>;
  proposals: ProgramAccount<Proposal>[];
  realmMembersSubscribedToNotifications: Record<string, PublicKey>;
}

interface DAOData {
  govData: GovernorData;
  proposalCount: number;
  address: PublicKey;
  name: string;
  slug: string;
}

/*
Realms use case:
When a proposal is added to a realm -
1. send a tweet out

---

* global data fetch
1. Fetch all realms
2. Fetch all proposals

* filter or detect diff
3. Look for diffs in the proposals array
4. When finding a proposal added or removed
5. Send out tweet for new proposal
*/

const makeSDK = (): TribecaSDK => {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const keypair: Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
  );
  const wallet = Wallet_.embedded(keypair.secretKey);
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  const dialectConnection = new Connection(RPC_URL, 'recent');
  const dialectProvider = new Provider(
    dialectConnection,
    wallet,
    Provider.defaultOptions(),
  );

  const provider = SolanaProvider.load({
    connection: dialectProvider.connection,
    sendConnection: dialectProvider.connection,
    wallet: dialectProvider.wallet,
    opts: dialectProvider.opts,
  });
  return TribecaSDK.load({
    provider,
  });
};

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly notificationSink: NotificationSink<TwitterNotification> =
    new TwitterNotificationsSink();

  private readonly logger = new Logger(MonitoringService.name);
  private tribecaSDK = makeSDK();
  private counter = 3;

  constructor(private readonly dialectConnection: DialectConnection) {}

  async onModuleInit() {
    this.initMonitor();
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }

  private initMonitor() {
    const monitor = Monitors.builder({
      monitorKeypair: this.dialectConnection.getKeypair(),
      dialectProgram: this.dialectConnection.getProgram(),
    })
      .defineDataSource<DAOData>()
      .poll(
        async () => this.getTribecaData(),
        Duration.fromObject({ seconds: 5 }),
      )
      .transform<number, number>({
        keys: ['proposalCount'],
        pipelines: [Pipelines.threshold(
          {
            type: 'increase',
            threshold: 1,
          },
        ),],
      })
      .notify()
      .custom<TwitterNotification>(({ value, context }) => {
        const {trace} = context;
        const triggerValues = trace.filter(data => data.type === 'trigger');
        const previousValues = triggerValues[0].input;
        const daoGovernorAddress = context.origin.address;

        return {
          prevTotal: previousValues[0],
          curTotal: previousValues[1],
          daoGovernorAddress,
          tribecaSDK: this.tribecaSDK,
          name: context.origin.name,
          slug: context.origin.slug,
        };
      }, this.notificationSink)
      .and()
      .dispatch('broadcast')
      .build();
    monitor.start();
  }

  private async getTribecaData(): Promise<SourceData<DAOData>[]> {
    const data = await fetch('https://raw.githubusercontent.com/TribecaHQ/tribeca-registry-build/master/registry/governor-metas.mainnet.json');
    const tribecaDataJson = await data.json();

    let sourceData: SourceData<DAOData>[] = [];

    for (const daoData of tribecaDataJson) {
      const governorAddress = new PublicKey(daoData.address);
      const govWrapper = new GovernorWrapper(this.tribecaSDK, governorAddress);

      const govData = await govWrapper.data();

      this.logger.log("Monitoring data for: ", daoData.name);

      sourceData.push({
        resourceId: governorAddress,
        data: {
          proposalCount: govData.proposalCount.toNumber() - this.counter,
          govData: govData,
          address: governorAddress,
          name: daoData.name,
          slug: daoData.slug,
        },
      });
    }
    this.counter -= 1;
    return sourceData;
  }
}
