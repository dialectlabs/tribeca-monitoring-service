import { TwitterApi } from 'twitter-api-v2';
import { Logger } from '@nestjs/common';
import { NotificationSink } from '@dialectlabs/monitor';
import { PublicKey } from '@solana/web3.js';
import {
  GovernorWrapper,
  ProposalMetaData,
  TribecaSDK,
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

  async push({
    prevTotal,
    curTotal,
    daoGovernorAddress,
    tribecaSDK,
    name,
    slug,
  }: TwitterNotification): Promise<void> {
    const newestProposals = await this.getNewestProposals(
      prevTotal,
      curTotal,
      daoGovernorAddress,
      tribecaSDK,
      name,
    );
    const filteredProposals: ProposalMetaData[] = newestProposals.filter(
      (proposal): proposal is ProposalMetaData => proposal != null,
    );
    let message = this.constructMessage(
      filteredProposals,
      prevTotal,
      name,
      slug,
    );

    let shortenedText = message.replace(/\s+/g, ' ').slice(0, maxMsgLen);
    // TODO: replace links with 23 characters (https://help.twitter.com/en/using-twitter/how-to-tweet-a-link)
    // const lastIndexOfSpace = shortenedText.lastIndexOf(' ');
    // shortenedText =
    //   lastIndexOfSpace === -1
    //     ? shortenedText
    //     : shortenedText.slice(0, lastIndexOfSpace);
    if (shortenedText.length === 0) {
      this.logger.warn(
        `Could not generate message for: ${name} (${daoGovernorAddress.toBase58()}) from indices ${prevTotal} to ${curTotal}`,
      );
      return;
    }
    this.logger.log(shortenedText);
    this.twitterClient &&
      (await this.twitterClient.v2
        .tweet({
          text: shortenedText,
        })
        .catch((it) => this.logger.error(it)));
    return;
  }

  async getNewestProposals(
    prevTotal: number,
    curTotal: number,
    daoGovernorAddress: PublicKey,
    tribecaSDK: TribecaSDK,
    name: string,
  ): Promise<(ProposalMetaData | null)[]> {
    const govWrapper = new GovernorWrapper(tribecaSDK, daoGovernorAddress);
    const indices = [...Array(curTotal - prevTotal).keys()];
    const proposalPromises = indices.map(
      async (i) => await govWrapper.findProposalAddress(new BN(i + prevTotal)),
    );

    this.logger.log(`Fetching proposals for indices ${indices.map(i => i + prevTotal)}`)
    const proposals = await Promise.all(proposalPromises);

    const proposalMetadataPromises = proposals.map(async (proposal) => {
      try {
        return await govWrapper.fetchProposalMeta(proposal);
      } catch {
        this.logger.warn(`Failed to fetch proposal with key: ${proposal.toBase58()} from DAO: ${name}.`)
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
          `📜 New proposal for ${name}: https://tribeca.so/gov/${slug}/proposals/${
            i + prevTotal
          } - ${proposal.title}`,
      ),
    ].join('\n');
  }
}

export class TwitterNotificationSinkNew
  implements NotificationSink<{message: string}>
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

  async push({
    message,
  }: {message: string}): Promise<void> {
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
}
