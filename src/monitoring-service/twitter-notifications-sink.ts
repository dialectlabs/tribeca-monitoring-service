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

  async push({ prevTotal, curTotal, daoGovernorAddress, tribecaSDK }: TwitterNotification): Promise<void> {
    const newestProposals = await this.getNewestProposals(prevTotal, curTotal, daoGovernorAddress, tribecaSDK);
    let message = this.constructMessage(newestProposals, prevTotal);

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
        .catch(() => this.logger.error(it)));
    return;
  }

  async getNewestProposals(prevTotal: number, curTotal: number, daoGovernorAddress: PublicKey, tribecaSDK: TribecaSDK): Promise<ProposalMetaData[]> {
    const govWrapper = new GovernorWrapper(tribecaSDK, daoGovernorAddress);
    const proposalPromises = [...Array(curTotal - prevTotal).keys()].map(async i =>
      await govWrapper.findProposalAddress(new BN(i + prevTotal))
    );

    const proposals = await Promise.all(proposalPromises);

    const proposalMetadataPromises = proposals.map(async proposal => await govWrapper.fetchProposalMeta(proposal));
    const proposalMetadatas = await Promise.all(proposalMetadataPromises);

    return proposalMetadatas;
  }

  private constructMessage(
    proposals: ProposalMetaData[],
    prevTotal: number,
  ): string {
    return [
      ...proposals.map(
        (proposal, i) =>
          `📜 New proposal for Saber: https://tribeca.so/gov/sbr/proposals/${i + prevTotal} - ${proposal.title}`,
      ),
    ].join('\n');
  }
}
