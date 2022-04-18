import { TwitterApi } from 'twitter-api-v2';
import { Logger } from '@nestjs/common';
import { NotificationSink } from '@dialectlabs/monitor';
import { PublicKey } from '@solana/web3.js';
import {
  TribecaSDK,
  GovernorWrapper,
  ProposalMetaData
} from '@tribecahq/tribeca-sdk';
import BN from 'bn.js';

export interface TwitterNotification {
  prevTotal: number;
  curTotal: number;
  daoGovernorAddress: PublicKey;
  tribecaSDK: TribecaSDK;
  name: string;
  slug: string;
}

const maxMsgLen = 250;

export class TwitterNotificationsSink
  implements NotificationSink<TwitterNotification>
{
  private readonly logger = new Logger(TwitterNotificationsSink.name);
  private twitterClient =
    !process.env.TEST_MODE &&
    new TwitterApi({
      appKey: process.env.TWITTER_APP_KEY!,
      appSecret: process.env.TWITTER_APP_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

  async push({ prevTotal, curTotal, daoGovernorAddress, tribecaSDK, name, slug }: TwitterNotification): Promise<void> {
    const newestProposals = await this.getNewestProposals(prevTotal, curTotal, daoGovernorAddress, tribecaSDK);
    const filteredProposals: ProposalMetaData[] = newestProposals.filter((proposal): proposal is ProposalMetaData => proposal != null);
    let message = this.constructMessage(filteredProposals, prevTotal, name, slug);

    let shortenedText = message.replace(/\s+/g, ' ').slice(0, maxMsgLen);
    // TODO: replace links with 23 characters (https://help.twitter.com/en/using-twitter/how-to-tweet-a-link)
    // const lastIndexOfSpace = shortenedText.lastIndexOf(' ');
    // shortenedText =
    //   lastIndexOfSpace === -1
    //     ? shortenedText
    //     : shortenedText.slice(0, lastIndexOfSpace);
    this.logger.log(shortenedText);
    this.twitterClient &&
      (await this.twitterClient.v2
        .tweet({
          text: shortenedText,
        })
        .catch((it) => this.logger.error(it)));
    return;
  }

  async getNewestProposals(prevTotal: number, curTotal: number, daoGovernorAddress: PublicKey, tribecaSDK: TribecaSDK): Promise<(ProposalMetaData | null)[]> {
    const govWrapper = new GovernorWrapper(tribecaSDK, daoGovernorAddress);
    const proposalPromises = [...Array(curTotal - prevTotal).keys()].map(async i =>
      await govWrapper.findProposalAddress(new BN(i + prevTotal))
    );

    const proposals = await Promise.all(proposalPromises);

    const proposalMetadataPromises = proposals.map(async proposal => {
      try {
        return await govWrapper.fetchProposalMeta(proposal);
      } catch {
        return null;
      }
    });
    const proposalMetadatas = await Promise.all(proposalMetadataPromises);

    return proposalMetadatas;
  }

  private constructMessage(
    proposals: ProposalMetaData[],
    prevTotal: number,
    name: string,
    slug: string,
  ): string {
    return [
      ...proposals.map(
        (proposal, i) =>
          `📜 New proposal for ${name}: https://tribeca.so/gov/${slug}/proposals/${i + prevTotal} - ${proposal.title}`,
      ),
    ].join('\n');
  }
}
