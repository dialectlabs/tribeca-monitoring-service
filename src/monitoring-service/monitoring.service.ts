import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
import { SolanaProvider } from '@saberhq/solana-contrib';
import {
  GovernorData,
  GovernorWrapper,
  TribecaSDK,
} from '@tribecahq/tribeca-sdk';
import { Provider } from '@project-serum/anchor';
import { Wallet_ } from '@dialectlabs/web3';
import { NoopSubscriberRepository } from './noop-subscriber-repository';

require('isomorphic-fetch');

interface DAOData {
  govData: GovernorData;
  proposalCount: number;
  address: PublicKey;
  name: string;
  slug: string;
}

/*
Tribeca use case:
When a proposal is added to a realm -
1. Send a tweet out

---

* global data fetch
1. Fetch all DAO info
2. Fetch individual DAO info and total proposals
3. Monitor the total proposal count
4. Diff the proposal counts on changes and query
   new indices for new proposal info
5. Send tweet
*/

const makeSDK = (): TribecaSDK => {
  const keypair: Keypair = Keypair.generate();
  const wallet = Wallet_.embedded(keypair.secretKey);
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  const connection = new Connection(RPC_URL, 'recent');
  const dialectProvider = new Provider(
    connection,
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
  // Sets testModeCounter to simulate last proposals as new proposals
  private testModeCounter = process.env.TEST_MODE ? 3 : 0;

  async onModuleInit() {
    this.initMonitor();
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }

  private initMonitor() {
    const monitor = Monitors.builder({
      subscriberRepository: new NoopSubscriberRepository(),
    })
      .defineDataSource<DAOData>()
      .poll(
        async () => this.getTribecaData(),
        Duration.fromObject({ seconds: 5 }),
      )
      .transform<number, number>({
        keys: ['proposalCount'],
        pipelines: [
          Pipelines.threshold({
            type: 'increase',
            threshold: 1,
          }),
        ],
      })
      .notify()
      .custom<TwitterNotification>(({ value, context }) => {
        const { trace } = context;
        const triggerValues = trace.filter((data) => data.type === 'trigger');
        const previousValues = triggerValues[0].input;
        const daoGovernorAddress = context.origin.address;

        this.logger.log(`Spotted a proposal count change for ${context.origin.name}. Proposal count: ${previousValues[0]} increased to ${previousValues[1]}`)

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
    const data = await fetch(
      'https://raw.githubusercontent.com/TribecaHQ/tribeca-registry-build/master/registry/governor-metas.mainnet.json',
    );
    const tribecaDataJson = await data.json();

    let sourceData: SourceData<DAOData>[] = [];

    for (const daoData of tribecaDataJson) {
      const governorAddress = new PublicKey(daoData.address);
      const govWrapper = new GovernorWrapper(this.tribecaSDK, governorAddress);

      const govData = await govWrapper.data();

      this.logger.log(`Monitoring data for: ${daoData.name}. Current proposal count: ${govData.proposalCount.toNumber()}`);

      sourceData.push({
        resourceId: governorAddress,
        data: {
          proposalCount:
            govData.proposalCount.toNumber() - this.testModeCounter,
          govData: govData,
          address: governorAddress,
          name: daoData.name,
          slug: daoData.slug,
        },
      });
    }
    if (process.env.TEST_MODE) {
      this.testModeCounter -= 1;
    }
    return sourceData;
  }
}
