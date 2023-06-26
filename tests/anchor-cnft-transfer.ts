import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { AnchorCnftTransfer } from "../target/types/anchor_cnft_transfer"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  ValidDepthSizePair,
  SPL_NOOP_PROGRAM_ID,
  ConcurrentMerkleTreeAccount,
} from "@solana/spl-account-compression"
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from "@metaplex-foundation/mpl-bubblegum"
import {
  PublicKey,
  Connection,
  clusterApiUrl,
  AccountMeta,
  Keypair,
} from "@solana/web3.js"
import { createTree, mintCompressedNFT, heliusApi } from "../utils/utils"

describe("anchor-cnft-transfer", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const wallet = provider.wallet as anchor.Wallet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")
  // const connection = new Connection("http://localhost:8899", "confirmed")

  const program = anchor.workspace
    .AnchorCnftTransfer as Program<AnchorCnftTransfer>

  let treeAddress: PublicKey
  let assetId1: PublicKey
  let assetId2: PublicKey

  before(async () => {
    const maxDepthSizePair: ValidDepthSizePair = {
      maxDepth: 3,
      maxBufferSize: 8,
    }

    const canopyDepth = 0

    treeAddress = await createTree(
      connection,
      wallet.payer,
      maxDepthSizePair,
      canopyDepth
    )

    assetId1 = await mintCompressedNFT(connection, wallet.payer, treeAddress)
    assetId2 = await mintCompressedNFT(connection, wallet.payer, treeAddress)

    console.log(`\n`)
  })

  it("Transfer Cnft, Manual CPI", async () => {
    const [assetData, assetProofData] = await Promise.all([
      heliusApi("getAsset", { id: assetId1.toBase58() }),
      heliusApi("getAssetProof", { id: assetId1.toBase58() }),
    ])

    const { compression, ownership } = assetData
    const { proof, root } = assetProofData

    const treePublicKey = new PublicKey(compression.tree)
    const ownerPublicKey = new PublicKey(ownership.owner)
    const delegatePublicKey = ownership.delegate
      ? new PublicKey(ownership.delegate)
      : ownerPublicKey

    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      treePublicKey
    )
    const treeAuthority = treeAccount.getAuthority()
    const canopyDepth = treeAccount.getCanopyDepth() || 0

    const proofPath: AccountMeta[] = proof
      .map((node: string) => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
      }))
      .slice(0, proof.length - canopyDepth)

    const receiver = Keypair.generate()
    const newLeafOwner = receiver.publicKey

    const txSignature = await program.methods
      .transferOne(
        Array.from(new PublicKey(root.trim()).toBytes()),
        Array.from(new PublicKey(compression.data_hash.trim()).toBytes()),
        Array.from(new PublicKey(compression.creator_hash.trim()).toBytes()),
        new anchor.BN(compression.leaf_id),
        compression.leaf_id
      )
      .accounts({
        leafOwner: ownerPublicKey,
        leafDelegate: delegatePublicKey,
        newLeafOwner: newLeafOwner,
        merkleTree: treePublicKey,
        treeAuthority: treeAuthority,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      })
      .remainingAccounts(proofPath)
      .rpc()

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
  })

  it("Transfer Cnft, Fails with Error Code: LeafAuthorityMustSign", async () => {
    const [assetData, assetProofData] = await Promise.all([
      heliusApi("getAsset", { id: assetId2.toBase58() }),
      heliusApi("getAssetProof", { id: assetId2.toBase58() }),
    ])

    const { compression, ownership } = assetData
    const { proof, root } = assetProofData

    const treePublicKey = new PublicKey(compression.tree)
    const ownerPublicKey = new PublicKey(ownership.owner)
    const delegatePublicKey = ownership.delegate
      ? new PublicKey(ownership.delegate)
      : ownerPublicKey

    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      treePublicKey
    )
    const treeAuthority = treeAccount.getAuthority()
    const canopyDepth = treeAccount.getCanopyDepth() || 0

    const proofPath: AccountMeta[] = proof
      .map((node: string) => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
      }))
      .slice(0, proof.length - canopyDepth)

    const receiver = Keypair.generate()
    const newLeafOwner = receiver.publicKey

    const txSignature = await program.methods
      .transferTwo(
        Array.from(new PublicKey(root.trim()).toBytes()),
        Array.from(new PublicKey(compression.data_hash.trim()).toBytes()),
        Array.from(new PublicKey(compression.creator_hash.trim()).toBytes()),
        new anchor.BN(compression.leaf_id),
        compression.leaf_id
      )
      .accounts({
        leafOwner: ownerPublicKey,
        leafDelegate: delegatePublicKey,
        newLeafOwner: newLeafOwner,
        merkleTree: treePublicKey,
        treeAuthority: treeAuthority,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      })
      .remainingAccounts(proofPath)
      .rpc()

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
  })
})
